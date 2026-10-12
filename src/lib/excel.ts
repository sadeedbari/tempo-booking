import ExcelJS from "exceljs";

/** Minimal, tidy .xlsx writer: bold shaded header row, frozen header, filters, sized columns. */

export interface Col {
  header: string;
  key: string;
  width?: number;
  /** Excel number format, e.g. "#,##0.00", "0.0%", "yyyy-mm-dd". */
  fmt?: string;
  align?: "left" | "center" | "right";
}

export type Cell =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  /** A value with its own format/emphasis (overrides the column's). */
  | { v: string | number | Date | null; fmt?: string; bold?: boolean };

export interface Sheet {
  /** Tab name (Excel allows 31 characters and no \ / ? * [ ] :). */
  name: string;
  /** Optional heading rows above the table, e.g. the period covered. */
  title?: string;
  subtitle?: string;
  columns: Col[];
  rows: Record<string, Cell>[];
  /** Freeze this many leading columns (e.g. the person's name). */
  freezeColumns?: number;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const safeName = (n: string) => n.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";

/** A UTC-midnight Date for a "YYYY-MM-DD" key, so Excel shows exactly that calendar day. */
export const dayToDate = (day: string) => new Date(`${day}T00:00:00Z`);

export async function workbookBuffer(sheets: Sheet[], creator = "Tempo"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(safeName(s.name), { views: [] });
    let row = 1;
    if (s.title) {
      ws.getCell(row, 1).value = s.title;
      ws.getCell(row, 1).font = { bold: true, size: 14 };
      row++;
      if (s.subtitle) {
        ws.getCell(row, 1).value = s.subtitle;
        ws.getCell(row, 1).font = { color: { argb: "FF6E6E73" }, size: 11 };
        row++;
      }
      row++; // blank line before the table
    }

    const headerRow = row;
    s.columns.forEach((c, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = c.header;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDF0" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFBDBDC2" } } };
      cell.alignment = { vertical: "middle", horizontal: c.align ?? "left", wrapText: true };
      ws.getColumn(i + 1).width = c.width ?? Math.min(40, Math.max(10, c.header.length + 4));
    });

    s.rows.forEach((r, ri) => {
      s.columns.forEach((c, ci) => {
        const raw = r[c.key];
        const cell = ws.getCell(headerRow + 1 + ri, ci + 1);
        const obj = raw !== null && typeof raw === "object" && !(raw instanceof Date) ? raw : null;
        cell.value = (obj ? obj.v : (raw as string | number | boolean | Date | null | undefined)) ?? null;
        const fmt = obj?.fmt ?? c.fmt;
        if (fmt) cell.numFmt = fmt;
        if (obj?.bold) cell.font = { bold: true };
        cell.alignment = { vertical: "top", horizontal: c.align ?? (typeof cell.value === "number" ? "right" : "left"), wrapText: true };
      });
    });

    const last = headerRow + Math.max(1, s.rows.length);
    ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: s.freezeColumns ?? 0, topLeftCell: `A${headerRow + 1}` }];
    if (s.rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: s.columns.length } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
