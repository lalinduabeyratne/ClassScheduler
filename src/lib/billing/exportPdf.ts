import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { MonthlySummary } from "@/lib/model/types";

function money(cents: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

export function exportStudentMonthlyPdf(args: {
  studentName: string;
  month: string;
  summary: MonthlySummary;
  rows: Array<{ date: string; status: string; feeCents: number }>;
}) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Student Monthly Fee Report", 14, 16);
  doc.setFontSize(11);
  doc.text(`Student: ${args.studentName}`, 14, 26);
  doc.text(`Month: ${args.month}`, 14, 32);

  autoTable(doc, {
    startY: 40,
    head: [["Date", "Status", "Fee Charged"]],
    body: args.rows.map((r) => [r.date, r.status.replaceAll("_", " "), money(r.feeCents)]),
    styles: { fontSize: 10 },
  });

  const y = (doc as any).lastAutoTable?.finalY ? Number((doc as any).lastAutoTable.finalY) + 10 : 60;
  doc.text(`Opening Balance: ${money(args.summary.openingBalanceCents)}`, 14, y);
  doc.text(`Total Earned: ${money(args.summary.totalEarnedCents)}`, 14, y + 6);
  doc.text(`Total Paid: ${money(args.summary.totalPaidCents)}`, 14, y + 12);
  doc.text(`Closing Balance: ${money(args.summary.closingBalanceCents)}`, 14, y + 18);
  doc.text(`Closing Due: ${money(args.summary.dueCents)}`, 14, y + 24);
  doc.text(`Closing Credit: ${money(args.summary.creditCents)}`, 14, y + 30);

  const safeName = args.studentName.replace(/[^\w.-]+/g, "_");
  doc.save(`${safeName}_${args.month}_report.pdf`);
}