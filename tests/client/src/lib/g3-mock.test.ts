import { describe, it, expect } from "vitest";
import { parseCsvLeads, mapRowsToLeads, parseCsvClientDemands } from "@/lib/g3-mock";

describe("mapRowsToLeads", () => {
  it("maps recognized headers into Lead objects, defaulting language to English", () => {
    const rows = [
      ["Full Name", "Email", "Target Language"],
      ["Jane Doe", "jane@x.com", "German"],
    ];
    const leads = mapRowsToLeads(rows);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      display_name: "Jane Doe",
      email: "jane@x.com",
      target_language: "German",
      identity_resolved: true,
      flags: [],
    });
  });

  it("flags a contact-less row On Hold and unresolved", () => {
    const rows = [["Full Name", "Target Language"], ["No Contact", "French"]];
    const leads = mapRowsToLeads(rows);
    expect(leads[0].identity_resolved).toBe(false);
    expect(leads[0].flags).toEqual(["On Hold"]);
  });

  it("splits a delimited services column into an array", () => {
    const rows = [["Full Name", "Services"], ["Jane", "Subtitling, Dubbing; Voice Over"]];
    const leads = mapRowsToLeads(rows);
    expect(leads[0].services).toEqual(["Subtitling", "Dubbing", "Voice Over"]);
  });

  it("leaves services empty (never a guessed default) when no Services column is present", () => {
    const rows = [["Full Name", "Country"], ["Jane", "USA"]];
    expect(mapRowsToLeads(rows)[0].services).toEqual([]);
  });

  it("maps a source column keyword to the canonical Source enum", () => {
    const rows = [
      ["Full Name", "Source"],
      ["A", "linkedin.com/in/a"],
      ["B", "ProZ.com profile"],
      ["C", "Referral from client"],
      ["D", "unknown platform"],
    ];
    const leads = mapRowsToLeads(rows);
    expect(leads.map((l) => l.source)).toEqual(["LinkedIn", "ProZ", "Referral", "Import"]);
  });

  it("skips a row with no name, email, language, or profile link at all", () => {
    const rows = [["Full Name", "Email"], ["", ""]];
    expect(mapRowsToLeads(rows)).toEqual([]);
  });

  it("returns an empty array for a header-only or empty sheet", () => {
    expect(mapRowsToLeads([["Full Name"]])).toEqual([]);
    expect(mapRowsToLeads([])).toEqual([]);
  });

  it("parses years of experience as a number, ignoring non-numeric values", () => {
    const rows = [["Full Name", "Years of Experience"], ["Jane", "5"]];
    expect(mapRowsToLeads(rows)[0].years_experience).toBe(5);
    const rowsInvalid = [["Full Name", "Years of Experience"], ["Bob", "n/a"]];
    expect(mapRowsToLeads(rowsInvalid)[0].years_experience).toBeUndefined();
  });
});

describe("parseCsvLeads", () => {
  it("parses raw CSV text (header + data rows) into Lead objects via the same field mapping as mapRowsToLeads", () => {
    const csv = "Full Name,Email\nJane Doe,jane@x.com\nBob Smith,bob@x.com";
    const leads = parseCsvLeads(csv);
    expect(leads).toHaveLength(2);
    expect(leads.map((l) => l.display_name)).toEqual(["Jane Doe", "Bob Smith"]);
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Full Name,Country\n"Doe, Jane",USA';
    const leads = parseCsvLeads(csv);
    expect(leads[0].display_name).toBe("Doe, Jane");
    expect(leads[0].country).toBe("USA");
  });

  it("returns an empty array for a header-only CSV", () => {
    expect(parseCsvLeads("Full Name,Email")).toEqual([]);
  });

  it("ignores blank lines", () => {
    const csv = "Full Name,Country\nJane,USA\n\n\nBob,UK";
    expect(parseCsvLeads(csv)).toHaveLength(2);
  });
});

describe("parseCsvClientDemands", () => {
  it("parses one row into one ClientDemand per language/service combination", () => {
    const csv = "Client,Target Language,Service,Headcount\nNetflix,German,Subtitling,3";
    const demands = parseCsvClientDemands(csv);
    expect(demands).toHaveLength(1);
    expect(demands[0]).toMatchObject({ client: "Netflix", language: "German", services: ["Subtitling"], headcount_needed: 3, gap: 3, filled: 0 });
  });

  it("cross-multiplies multiple languages and services into separate demand rows", () => {
    const csv = "Client,Target Language,Service\nNetflix,German;French,Subtitling;Dubbing";
    const demands = parseCsvClientDemands(csv);
    expect(demands).toHaveLength(4);
    expect(demands.map((d) => `${d.language}/${d.services[0]}`).sort()).toEqual([
      "French/Dubbing",
      "French/Subtitling",
      "German/Dubbing",
      "German/Subtitling",
    ]);
  });

  it("classifies priority from free-text urgency keywords", () => {
    const csv = "Client,Target Language,Priority\nA,German,Urgent\nB,German,High\nC,German,Standard";
    const demands = parseCsvClientDemands(csv);
    expect(demands.map((d) => d.priority)).toEqual(["critical", "high", "standard"]);
  });

  it("defaults headcount to 1 and clamps a non-positive/invalid value up to 1", () => {
    const csv = "Client,Target Language,Headcount\nA,German,-5\nB,German,abc";
    const demands = parseCsvClientDemands(csv);
    expect(demands.map((d) => d.headcount_needed)).toEqual([1, 1]);
  });

  it("returns an empty array for a header-only CSV", () => {
    expect(parseCsvClientDemands("Client,Target Language")).toEqual([]);
  });
});
