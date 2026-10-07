import { NextResponse, NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Define route permissions
const routePermissions = {
  // Public routes don't need to be listed
  // Admin routes
  "/dashboard/admin": ["ADMIN"],
  "/dashboard/admin/users": ["ADMIN"],
  "/dashboard/admin/clients": ["ADMIN"],
  "/dashboard/admin/users/create": ["ADMIN"],
  // Admin or Partner routes
  "/dashboard/manage-users": ["ADMIN", "PARTNER"],
  // Partner routes
  "/dashboard/partner": ["ADMIN", "PARTNER"],
  "/dashboard/partner/users/create": ["ADMIN", "PARTNER"],
  "/dashboard/partner/users": ["ADMIN", "PARTNER"],
  "/dashboard/partner/users/[id]": ["ADMIN", "PARTNER"], // Only view details
  // Restrict these routes to ADMIN only
  "/dashboard/partner/users/[id]/edit": ["ADMIN"],
  "/dashboard/partner/users/[id]/reset-password": ["ADMIN"],
  // Junior staff routes
  "/dashboard/junior": ["ADMIN", "PARTNER", "BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"],
  // Client management routes - accessible to all staff
  "/dashboard/clients": ["ADMIN", "PARTNER", "BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"],
  "/dashboard/clients/[id]": ["ADMIN", "PARTNER", "BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"],
  // Restrict creation and modification to ADMIN only
  "/dashboard/clients/create": ["ADMIN"],
  "/dashboard/clients/guest/create": ["ADMIN"],
  "/dashboard/clients/[id]/edit": ["ADMIN"],
  // Task management routes (partners may only edit tasks they created; enforced by the API)
  "/dashboard/tasks/create": ["ADMIN", "PARTNER"],
  "/dashboard/tasks/[id]/edit": ["ADMIN", "PARTNER"],
  // Task viewing - all staff
  "/dashboard/tasks": ["ADMIN", "PARTNER", "BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"],
  "/dashboard/tasks/[id]": ["ADMIN", "PARTNER", "BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"],
  // Task reassignment - admin and partner
  "/dashboard/tasks/[id]/reassign": ["ADMIN", "PARTNER"],
  // All authenticated users
  "/dashboard": ["ADMIN", "PARTNER", "BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"],
};

type PermissionRoute = keyof typeof routePermissions;

const isDynamicSegment = (segment: string) => /^\[[^\]]+\]$/.test(segment);

// A route covers the path itself and everything below it; "[id]"-style segments match any single segment
const routeCoversPath = (route: string, pathSegments: string[]) => {
  const routeSegments = route.split("/").filter(Boolean);
  if (routeSegments.length > pathSegments.length) return false;
  return routeSegments.every(
    (segment, i) => isDynamicSegment(segment) || segment === pathSegments[i]
  );
};

// Ranks a route so deeper routes win, and literal segments beat dynamic ones at the same position
// (e.g. "/dashboard/clients/create" over "/dashboard/clients/[id]" over "/dashboard/clients")
const routeSpecificity = (route: string) =>
  route
    .split("/")
    .filter(Boolean)
    .map((segment) => (isDynamicSegment(segment) ? 1 : 2));

const compareSpecificity = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// Returns the most specific route permission entry that covers the path
function findRoutePermission(pathname: string): PermissionRoute | undefined {
  const pathSegments = pathname.split("/").filter(Boolean);
  let best: PermissionRoute | undefined;

  for (const route of Object.keys(routePermissions) as PermissionRoute[]) {
    if (!routeCoversPath(route, pathSegments)) continue;
    if (!best || compareSpecificity(routeSpecificity(route), routeSpecificity(best)) > 0) {
      best = route;
    }
  }

  return best;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // PWA files must be public and must not be cached long-term
  // (the service worker has to update, and iOS fetches the manifest without a session)
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") {
    return NextResponse.next();
  }

  // Add improved caching for static assets
  if (
    pathname.startsWith('/_next/static') ||
    pathname.includes('/images/') ||
    pathname.includes('/favicon.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  ) {
    const response = NextResponse.next();
    
    // Set more aggressive caching for static assets
    response.headers.set(
      'Cache-Control',
      'public, max-age=31536000, immutable'
    );
    
    // Add content-type based on extension if missing
    if (!request.headers.get('content-type')) {
      if (pathname.endsWith('.css')) {
        response.headers.set('Content-Type', 'text/css');
      } else if (pathname.endsWith('.js')) {
        response.headers.set('Content-Type', 'application/javascript');
      } else if (pathname.endsWith('.png')) {
        response.headers.set('Content-Type', 'image/png');
      } else if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
        response.headers.set('Content-Type', 'image/jpeg');
      } else if (pathname.endsWith('.svg')) {
        response.headers.set('Content-Type', 'image/svg+xml');
      }
    }
    
    return response;
  }

  // Skip middleware for public routes and API routes to avoid infinite loops
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") || // Skip ALL API routes to prevent loops
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/set-password" ||
    pathname.includes("favicon")
  ) {
    return NextResponse.next();
  }

  // Get the session token
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Not signed in - redirect to login
  if (!token) {
    // If user is accessing the root URL, show the landing page
    if (pathname === "/") {
      return NextResponse.next();
    }
    // For all other protected routes, redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Check if user is blocked based on JWT token
  if (token.blocked) {
    return signOutAndRedirect(request);
  }

  // Check if user is blocked based on JWT token
  if (token.isActive === false) {
    return NextResponse.redirect(new URL("/login?blocked=true", request.url));
  }

  // Handle root redirect
  if (pathname === "/") {
    // User is logged in - redirect based on role
    const userRole = token.role as string;
    
    if (userRole === "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard/admin", request.url));
    } else if (userRole === "PARTNER") {
      return NextResponse.redirect(new URL("/dashboard/partner", request.url)); 
    } else if (["BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"].includes(userRole)) {
      // Redirect junior staff
      return NextResponse.redirect(new URL("/dashboard/junior", request.url));
    } else {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // Find matching route permission pattern
  const matchedRoute = findRoutePermission(pathname);

  // Check role-based access
  if (matchedRoute) {
    const userRole = token.role as string;
    const allowedRoles = routePermissions[matchedRoute];
    
    if (!allowedRoles.includes(userRole)) {
      // Redirect to appropriate dashboard based on role
      if (userRole === "ADMIN") {
        return NextResponse.redirect(new URL("/dashboard/admin", request.url));
      } else if (userRole === "PARTNER") {
        return NextResponse.redirect(new URL("/dashboard/partner", request.url));
      } else if (["BUSINESS_EXECUTIVE", "BUSINESS_CONSULTANT"].includes(userRole)) {
        return NextResponse.redirect(new URL("/dashboard/junior", request.url));
      } else {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
  }

  return NextResponse.next();
}

// Helper function to sign out and redirect
function signOutAndRedirect(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?reason=role-changed", request.url));
  
  // Clear auth cookies
  response.cookies.delete("next-auth.session-token");
  response.cookies.delete("next-auth.csrf-token");
  response.cookies.delete("next-auth.callback-url");
  response.cookies.delete("__Secure-next-auth.callback-url");
  response.cookies.delete("__Host-next-auth.csrf-token");
  
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};