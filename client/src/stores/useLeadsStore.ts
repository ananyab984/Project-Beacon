import { create } from "zustand";
import {
  type Lead,
  type Stage,
  type Availability,
  type Flag,
  leads as defaultG3Leads,
} from "@/lib/g3-mock";
import {
  type RecruiterLead,
  initialRecruiterStore,
} from "@/lib/recruiter-mock";

export interface LeadsFilter {
  search: string;
  stage: Stage | "All";
  availability: Availability | "All";
  flag: Flag | "All";
  recruiterId: string | "All";
}

interface LeadsState {
  g3Leads: Lead[];
  recruiterLeads: RecruiterLead[];
  selectedLeadIds: string[];
  activeLeadId: string | null;
  filters: LeadsFilter;

  setG3Leads: (leads: Lead[]) => void;
  setRecruiterLeads: (leads: RecruiterLead[]) => void;
  updateLeadStage: (id: string, stage: Stage) => void;
  bulkUpdateLeadStage: (ids: string[], stage: Stage) => void;
  bulkAssignRecruiter: (ids: string[], recruiterId: string) => void;
  toggleLeadFlag: (id: string, flag: Flag) => void;
  addRecruiterLead: (lead: RecruiterLead) => void;
  setSelectedLeadIds: (ids: string[]) => void;
  toggleSelectLead: (id: string) => void;
  clearSelection: () => void;
  setActiveLeadId: (id: string | null) => void;
  setFilter: <K extends keyof LeadsFilter>(key: K, value: LeadsFilter[K]) => void;
  resetFilters: () => void;
}

const initialFilters: LeadsFilter = {
  search: "",
  stage: "All",
  availability: "All",
  flag: "All",
  recruiterId: "All",
};

export const useLeadsStore = create<LeadsState>((set) => ({
  g3Leads: [],
  recruiterLeads: [],
  selectedLeadIds: [],
  activeLeadId: null,
  filters: initialFilters,

  setG3Leads: (g3Leads) => set({ g3Leads }),
  setRecruiterLeads: (recruiterLeads) => set({ recruiterLeads }),

  updateLeadStage: (id, stage) => {
    set((state) => ({
      g3Leads: state.g3Leads.map((l) => (l.id === id ? { ...l, stage } : l)),
    }));
  },

  bulkUpdateLeadStage: (ids, stage) => {
    set((state) => {
      const idSet = new Set(ids);
      return {
        g3Leads: state.g3Leads.map((l) => (idSet.has(l.id) ? { ...l, stage } : l)),
        selectedLeadIds: [],
      };
    });
  },

  bulkAssignRecruiter: (ids, recruiterId) => {
    set((state) => {
      const idSet = new Set(ids);
      return {
        g3Leads: state.g3Leads.map((l) =>
          idSet.has(l.id) ? { ...l, recruiter_id: recruiterId } : l
        ),
        selectedLeadIds: [],
      };
    });
  },

  toggleLeadFlag: (id, flag) => {
    set((state) => ({
      g3Leads: state.g3Leads.map((l) => {
        if (l.id !== id) return l;
        const hasFlag = l.flags.includes(flag);
        const flags = hasFlag ? l.flags.filter((f) => f !== flag) : [...l.flags, flag];
        return { ...l, flags };
      }),
    }));
  },

  addRecruiterLead: (newLead) => {
    set((state) => ({
      recruiterLeads: [newLead, ...state.recruiterLeads],
    }));
  },

  setSelectedLeadIds: (selectedLeadIds) => set({ selectedLeadIds }),

  toggleSelectLead: (id) => {
    set((state) => {
      const exists = state.selectedLeadIds.includes(id);
      const selectedLeadIds = exists
        ? state.selectedLeadIds.filter((x) => x !== id)
        : [...state.selectedLeadIds, id];
      return { selectedLeadIds };
    });
  },

  clearSelection: () => set({ selectedLeadIds: [] }),

  setActiveLeadId: (activeLeadId) => set({ activeLeadId }),

  setFilter: (key, value) => {
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    }));
  },

  resetFilters: () => set({ filters: initialFilters }),
}));
