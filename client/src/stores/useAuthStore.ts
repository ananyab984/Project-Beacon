import { create } from "zustand";
import { type AuthUser, type Role } from "@/lib/auth";

interface AuthState {
  user: AuthUser | null;
  activeRole: Role;
  activeRecruiterId: string;
  activeContractorId: string;
  isAuthenticated: boolean;

  setUser: (user: AuthUser | null) => void;
  setActiveRole: (role: Role) => void;
  setActiveRecruiterId: (id: string) => void;
  setActiveContractorId: (id: string) => void;
  logout: () => void;
}

const defaultUser: AuthUser = {
  id: "u_owner",
  email: "ethan@global3.co",
  name: "Ethan",
  role: "owner",
  emailVerified: true,
};

export const useAuthStore = create<AuthState>((set) => ({
  user: defaultUser,
  activeRole: "owner",
  activeRecruiterId: "r_riya",
  activeContractorId: "ct_alex",
  isAuthenticated: true,

  setUser: (user) =>
    set({
      user,
      activeRole: user?.role || "owner",
      isAuthenticated: !!user,
    }),

  setActiveRole: (role) => set({ activeRole: role }),

  setActiveRecruiterId: (activeRecruiterId) => set({ activeRecruiterId }),

  setActiveContractorId: (activeContractorId) => set({ activeContractorId }),

  logout: () =>
    set({
      user: null,
      isAuthenticated: false,
    }),
}));
