import { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-logger";

const isProduction = process.env.NODE_ENV === "production";

// The signed-in user from the session, so API routes don't have to look the
// user up in the database again on every request. The JWT callback below
// re-checks the user (active, role unchanged) at most once a minute.
// Returns null for blocked users or a session without an id.
export function getSessionUser(session: Session | null) {
  if (!session?.user?.id || (session as { blocked?: boolean }).blocked) {
    return null;
  }
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };
}

// How often the JWT callback re-reads the user from the database.
// Without this, every getServerSession()/useSession() call costs a DB round trip.
const USER_REFRESH_INTERVAL_MS = 60 * 1000;

// Get your actual domain from the URL
const getVercelDomain = () => {
  if (!process.env.NEXTAUTH_URL) return undefined;
  try {
    const url = new URL(process.env.NEXTAUTH_URL);
    // Only return the domain for production
    return isProduction ? url.hostname : undefined;
  } catch {
    return undefined;
  }
};

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }
        const normalizedEmail = credentials.email.toLowerCase().trim();  
        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true, 
            avatar: true, 
            isActive: true, 
            password: true,
            canApproveBilling: true,
            roleVersion: true,
          }, // Include avatar, isActive, and password
        });

        if (!user) {
          return null;
        }

        // Check if user is blocked (inactive)
        if (user.isActive === false) {
          throw new Error("AccountBlocked");
        }

        const passwordMatches = await compare(credentials.password, user.password || "");

        if (!passwordMatches) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          canApproveBilling: user.canApproveBilling,
          roleVersion: user.roleVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          id: user.id,
          role: user.role,
          avatar: user.avatar || null,
          canApproveBilling: user.canApproveBilling || false,
          roleVersion: user.roleVersion,
          checkedAt: Date.now(),
        };
      }

      // Skip the DB lookup if the token was verified recently
      if (
        !token.blocked &&
        typeof token.checkedAt === "number" &&
        Date.now() - token.checkedAt < USER_REFRESH_INTERVAL_MS
      ) {
        return token;
      }

      try {
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { 
            isActive: true, 
            avatar: true, 
            canApproveBilling: true,
            role: true,
            roleVersion: true,
          },
        });

        if (!user || !user.isActive) {
          return {
            ...token,
            blocked: true,
          };
        }

        // Check if role or roleVersion changed
        if (token.role !== user.role || token.roleVersion !== user.roleVersion) {
          return {
            ...token,
            blocked: true,
            roleChanged: true,
          };
        }

        return {
          ...token,
          avatar: user.avatar || null,
          canApproveBilling: user.canApproveBilling || false,
          role: user.role,
          roleVersion: user.roleVersion,
          checkedAt: Date.now(),
        };
      } catch (error) {
        console.error("Database error in JWT callback:", error);
        // Return token anyway to prevent login blocking
        return token;
      }
    },

    async session({ session, token }) {
      if (token.blocked) {
        return { ...session, blocked: true, roleChanged: token.roleChanged };
      }

      return {
        ...session,
        user: {
          ...session.user,
          id: token.id as string,
          role: token.role,
          avatar: token.avatar || null,
          canApproveBilling: token.canApproveBilling || false,
          roleVersion: token.roleVersion as number,
        },
      };
    },

    async signIn({ user }) {
      if (user.id) {
        try {
          await logActivity(
            "user",
            "login",
            user.name || user.email || "Unknown user",
            user.id
          );
        } catch (error) {
          console.error("Failed to log login activity:", error);
        }
      }

      return true;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.sub) {
        try {
          const user = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { name: true },
          });

          await logActivity(
            "user",
            "logout",
            user?.name || "Unknown user",
            token.sub
          );
        } catch (error) {
          console.error("Failed to log logout activity:", error);
        }
      }
    },
  },
  cookies: {
    sessionToken: {
      name: `${isProduction ? '__Secure-' : ''}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
        // Remove domain configuration for development
      },
    },
  },
  debug: process.env.NODE_ENV === "development",
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
    // Make sure there's no hardcoded secret here
  },
};