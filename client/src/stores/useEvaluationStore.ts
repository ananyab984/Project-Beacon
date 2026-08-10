import { create } from "zustand";
import { type RecruiterKPIs } from "@/lib/g3-mock";

export interface EvaluationMetricConfig {
  metricKey: keyof RecruiterKPIs;
  label: string;
  weight: number;
  goodBand: number;
  direction: "higher_is_better" | "lower_is_better";
  unit: "%" | "count" | "days" | "index";
}

const defaultMetricConfigs: EvaluationMetricConfig[] = [
  {
    metricKey: "outreach_volume",
    label: "Outreach Volume",
    weight: 30,
    goodBand: 420,
    direction: "higher_is_better",
    unit: "count",
  },
  {
    metricKey: "response_rate",
    label: "Response Rate",
    weight: 20,
    goodBand: 25,
    direction: "higher_is_better",
    unit: "%",
  },
  {
    metricKey: "avg_turnaround_days",
    label: "Time to First Touch",
    weight: 20,
    goodBand: 1.0,
    direction: "lower_is_better",
    unit: "days",
  },
  {
    metricKey: "interview_to_offer",
    label: "Progression Rate",
    weight: 15,
    goodBand: 80,
    direction: "higher_is_better",
    unit: "%",
  },
  {
    metricKey: "profile_quality",
    label: "Profile Quality Index",
    weight: 15,
    goodBand: 90,
    direction: "higher_is_better",
    unit: "index",
  },
];

interface EvaluationState {
  selectedRecruiterId: string;
  metricConfigs: EvaluationMetricConfig[];
  period: string;

  setSelectedRecruiterId: (id: string) => void;
  setPeriod: (period: string) => void;
  updateMetricWeight: (metricKey: keyof RecruiterKPIs, weight: number) => void;
  updateMetricGoodBand: (metricKey: keyof RecruiterKPIs, goodBand: number) => void;
  resetConfigsToDefault: () => void;
}

export const useEvaluationStore = create<EvaluationState>((set) => ({
  selectedRecruiterId: "r_riya",
  metricConfigs: defaultMetricConfigs,
  period: "2026-08",

  setSelectedRecruiterId: (selectedRecruiterId) => set({ selectedRecruiterId }),

  setPeriod: (period) => set({ period }),

  updateMetricWeight: (metricKey, weight) =>
    set((state) => ({
      metricConfigs: state.metricConfigs.map((cfg) =>
        cfg.metricKey === metricKey ? { ...cfg, weight } : cfg
      ),
    })),

  updateMetricGoodBand: (metricKey, goodBand) =>
    set((state) => ({
      metricConfigs: state.metricConfigs.map((cfg) =>
        cfg.metricKey === metricKey ? { ...cfg, goodBand } : cfg
      ),
    })),

  resetConfigsToDefault: () => set({ metricConfigs: defaultMetricConfigs }),
}));
