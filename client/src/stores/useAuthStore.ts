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
  email: "owner@global3.co",
  name: "Owner User",
  role: "owner",
  emailVerified: true,
};

export const useAuthStore = create<AuthState>((set) => ({
  user: defaultUser,
  activeRole: "owner",
  activeRecruiterId: "",
  activeContractorId: "",
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
