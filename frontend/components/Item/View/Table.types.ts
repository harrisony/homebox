import type { ItemSummary } from "~~/lib/api/types/data-contracts";

export type TableHeader = {
  text: string;
  value: keyof ItemSummary;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  enabled: boolean;
  type?: "price" | "boolean" | "name" | "location" | "date";
};

// TODO: confirm we want to disable this
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TableData = Record<string, any>;
