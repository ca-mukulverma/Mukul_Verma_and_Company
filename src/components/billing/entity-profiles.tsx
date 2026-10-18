"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BILL_TYPE_LABELS, BillTypeValue } from "@/lib/billing-constants";
import { apiErrorMessage } from "./bill-types";

interface Entity {
  type: BillTypeValue;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pan: string | null;
  gstin: string | null;
  stateCode: string | null;
  sacCode: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  signatory: string | null;
  footerNote: string | null;
}

type Field = Exclude<keyof Entity, "type">;

const FIELDS: { key: Field; label: string; placeholder?: string; gstOnly?: boolean; long?: boolean }[] = [
  { key: "name", label: "Name on the bill" },
  { key: "address", label: "Address", long: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "pan", label: "PAN", placeholder: "ABCDE1234F" },
  { key: "gstin", label: "GSTIN", gstOnly: true },
  { key: "stateCode", label: "GST state code", placeholder: "e.g. 23 for Madhya Pradesh", gstOnly: true },
  { key: "sacCode", label: "SAC code", placeholder: "e.g. 998221", gstOnly: true },
  { key: "bankName", label: "Bank name" },
  { key: "bankAccount", label: "Account number" },
  { key: "bankIfsc", label: "IFSC" },
  { key: "bankBranch", label: "Branch" },
  { key: "signatory", label: "Signatory name" },
  { key: "footerNote", label: "Note at the bottom of the bill", long: true },
];

// Admin edits the letterhead and bank details printed on each type of bill
export function EntityProfiles() {
  const [entities, setEntities] = useState<Entity[] | null>(null);

  useEffect(() => {
    axios
      .get<{ entities: Entity[] }>("/api/billing/entities")
      .then((response) => setEntities(response.data.entities))
      .catch((error) => {
        toast.error(apiErrorMessage(error, "Could not load company profiles"));
        setEntities([]);
      });
  }, []);

  if (entities === null) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {entities.map((entity) => (
        <EntityForm key={entity.type} entity={entity} />
      ))}
    </div>
  );
}

function EntityForm({ entity }: { entity: Entity }) {
  const [values, setValues] = useState(entity);
  const [saving, setSaving] = useState(false);
  const isGst = entity.type === "GST";

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.put<Entity>("/api/billing/entities", values);
      setValues(response.data);
      toast.success(`${response.data.name} saved`);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{BILL_TYPE_LABELS[entity.type]}</CardTitle>
        <CardDescription>
          {isGst
            ? "Printed on GST tax invoices. The state code decides CGST + SGST or IGST."
            : "Printed on these bills. No GST is charged."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {FIELDS.filter((field) => isGst || !field.gstOnly).map((field) => {
            const id = `${entity.type}-${field.key}`;
            const props = {
              id,
              value: values[field.key] ?? "",
              placeholder: field.placeholder,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setValues({ ...values, [field.key]: e.target.value }),
            };
            return (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={id}>{field.label}</Label>
                {field.long ? <Textarea {...props} className="min-h-[70px]" /> : <Input {...props} />}
              </div>
            );
          })}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving || values.name.trim().length < 2}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
