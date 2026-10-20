"use client";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BILL_ISSUERS, BILL_TYPE_LABELS, BillTypeValue, MvcBillTypeValue } from "@/lib/billing-constants";

const NON_GST_TYPES: MvcBillTypeValue[] = ["NON_GST", "NON_GST_HV", "NON_GST_VLA"];

// Who an MVC bill is issued by: MVC & Company with GST, or without GST in the
// name of CA Mukul Verma, CA Harsh Verma or Verma Law Associates
export function BillTypeSelect({
  value,
  onChange,
  className,
  id,
}: {
  value: MvcBillTypeValue | null | undefined;
  onChange: (value: MvcBillTypeValue) => void;
  className?: string;
  id?: string;
}) {
  return (
    // "" (not undefined) keeps the choice controlled
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as MvcBillTypeValue)}>
      <SelectTrigger id={id} className={cn(!value && "border-amber-500", className)}>
        <SelectValue placeholder="Choose GST / Non-GST" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>With GST</SelectLabel>
          <SelectItem value="GST">{BILL_TYPE_LABELS.GST}</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Non-GST – bill in the name of</SelectLabel>
          {NON_GST_TYPES.map((type) => (
            <SelectItem key={type} value={type}>{BILL_TYPE_LABELS[type]}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// Short label for badges: "GST" or the name a Non-GST bill is issued in
export function billTypeShortLabel(type: BillTypeValue) {
  return type === "GST" ? "GST" : type === "BEDGE" ? "B Edge" : `Non-GST · ${BILL_ISSUERS[type]}`;
}
