import React from "react";

interface ClientLogoProps {
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const BRAND_CONFIGS: Record<string, { bg: string; text: string; label: string; border?: string }> = {
  netflix: {
    bg: "bg-[#E50914] text-white",
    text: "text-white font-black tracking-tighter",
    label: "N",
  },
  "amazon prime video": {
    bg: "bg-[#00A8E1] text-white",
    text: "text-white font-bold tracking-tight",
    label: "prime",
  },
  amazon: {
    bg: "bg-[#00A8E1] text-white",
    text: "text-white font-bold tracking-tight",
    label: "prime",
  },
  "disney+": {
    bg: "bg-[#113CCF] text-white",
    text: "text-white font-extrabold italic",
    label: "D+",
  },
  disney: {
    bg: "bg-[#113CCF] text-white",
    text: "text-white font-extrabold italic",
    label: "D+",
  },
  "warner bros. discovery": {
    bg: "bg-[#003865] text-[#FFB81C]",
    text: "text-[#FFB81C] font-black",
    label: "WB",
  },
  "warner bros.": {
    bg: "bg-[#003865] text-[#FFB81C]",
    text: "text-[#FFB81C] font-black",
    label: "WB",
  },
  "apple tv+": {
    bg: "bg-[#1D1D1F] text-white border border-white/20",
    text: "text-white font-semibold",
    label: "TV+",
  },
  apple: {
    bg: "bg-[#1D1D1F] text-white border border-white/20",
    text: "text-white font-semibold",
    label: "TV+",
  },
  hbo: {
    bg: "bg-[#5822B4] text-white",
    text: "text-white font-black",
    label: "HBO",
  },
  paramount: {
    bg: "bg-[#0064FF] text-white",
    text: "text-white font-bold",
    label: "P+",
  },
  sony: {
    bg: "bg-black text-white border border-border",
    text: "text-white font-bold tracking-widest",
    label: "SONY",
  },
  universal: {
    bg: "bg-[#0B1D3A] text-white",
    text: "text-white font-bold",
    label: "UNI",
  },
};

export function ClientLogo({ name, className = "", size = "md" }: ClientLogoProps) {
  const normalized = name.toLowerCase().trim();
  const matchedKey = Object.keys(BRAND_CONFIGS).find((key) => normalized.includes(key));
  const config = matchedKey ? BRAND_CONFIGS[matchedKey] : null;

  const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-8 w-8 text-xs",
    lg: "h-10 w-10 text-sm",
  }[size];

  if (config) {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center rounded-lg shadow-xs select-none ${config.bg} ${sizeClasses} ${className}`}
        title={name}
      >
        <span className={config.text}>{config.label}</span>
      </div>
    );
  }

  // Fallback: Generate custom initials logo with dynamic vibrant gradient
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-border/80 bg-gradient-to-br from-muted/80 to-muted text-foreground font-semibold shadow-xs select-none ${sizeClasses} ${className}`}
      title={name}
    >
      <span>{initials || "CL"}</span>
    </div>
  );
}
