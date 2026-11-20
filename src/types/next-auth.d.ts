import { UserRole } from "@prisma/client"
import NextAuth, { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface User {
    id: string
    role: UserRole;
    avatar: string | null
    canApproveBilling?: boolean 
    canFollowUpTasks?: boolean
    canViewDebtors?: boolean
    roleVersion: number
  }

  interface Session {
    user: {
      id: string
      role: UserRole
      avatar: string | null
      roleVersion: number
      // Admins, and partners switched on to follow up tasks (docs/TASKS.md)
      canFollowUpTasks?: boolean
      // Admins, and partners switched on to see Debtors (docs/TALLY_DEBTORS.md)
      canViewDebtors?: boolean
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role: UserRole
    avatar: string | null
    roleVersion: number
    checkedAt?: number
  }
}