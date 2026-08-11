import { create } from "zustand";
import {
  type ClientDemand,
  type LanguageDemand,
  initialClientDemands,
} from "@/lib/g3-mock";

interface ClientDemandState {
  demands: ClientDemand[];
  languageDemands: LanguageDemand[];
  selectedDemandId: string | null;
  searchFilter: string;

  setDemands: (demands: ClientDemand[]) => void;
  setLanguageDemands: (languageDemands: LanguageDemand[]) => void;
  setSelectedDemandId: (id: string | null) => void;
  setSearchFilter: (filter: string) => void;

  addClientDemand: (demand: ClientDemand | Omit<ClientDemand, "id">) => void;
  updateClientDemand: (id: string, updates: Partial<ClientDemand>) => void;
  assignRecruiterToDemand: (id: string, recruiterId: string) => void;
}

export const useClientDemandStore = create<ClientDemandState>((set) => ({
  demands: [],
  languageDemands: [],
  selectedDemandId: null,
  searchFilter: "",

  setDemands: (demands) => set({ demands }),
  setLanguageDemands: (languageDemands) => set({ languageDemands }),
  setSelectedDemandId: (selectedDemandId) => set({ selectedDemandId }),
  setSearchFilter: (searchFilter) => set({ searchFilter }),

  addClientDemand: (demand) =>
    set((state) => {
      const fullDemand: ClientDemand = "id" in demand && demand.id ? (demand as ClientDemand) : { ...demand, id: `cd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
      return { demands: [fullDemand, ...state.demands] };
    }),

  updateClientDemand: (id, updates) =>
    set((state) => ({
      demands: state.demands.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    })),

  assignRecruiterToDemand: (id, recruiter_id) =>
    set((state) => ({
      demands: state.demands.map((d) => (d.id === id ? { ...d, recruiter_id } : d)),
    })),
}));
