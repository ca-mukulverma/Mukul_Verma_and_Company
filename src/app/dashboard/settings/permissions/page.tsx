"use client";

import { Fragment, useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useSession } from "next-auth/react";
import axios from "axios";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { BILL_TYPE_LABELS, BILL_TYPES, BillTypeValue } from "@/lib/billing-constants";

export default function PermissionsPage() {
  const { data: session } = useSession();
  interface Partner {
    id: string;
    name: string;
    avatar: string | null; // Avatar URL or fallback
    canApproveBilling: boolean;
    canManageBedgeBilling: boolean;
    canEnterBillAmounts: boolean;
    canViewBillingList: boolean;
    // The Billing Lists the partner sees when Billing List is on
    billingListTypes: BillTypeValue[];
  }

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false); // State for dialog visibility

  // Fetch partners when the component mounts
  useEffect(() => {
    fetchPartners();
  }, []);

  // Fetch all partners from the backend
  const fetchPartners = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get("/api/admin/dashboard");
      const users = response.data.partners || [];
      setPartners(
        users.map((user: Partial<Partner> & { id: string; name: string }) => ({
          id: user.id,
          name: user.name,
          avatar: user.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name)}`, // Use DiceBear if no avatar
          canApproveBilling: user.canApproveBilling || false,
          canManageBedgeBilling: user.canManageBedgeBilling || false,
          canEnterBillAmounts: user.canEnterBillAmounts || false,
          canViewBillingList: user.canViewBillingList || false,
          // Saved as [] for "all"
          billingListTypes: user.billingListTypes?.length ? user.billingListTypes : [...BILL_TYPES],
        }))
      );
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch partners:", err);
      setError("Failed to fetch partners. Please try again later.");
      setLoading(false);
    }
  };

  // Toggle a billing permission for a partner
  const handleToggle = (
    id: string,
    permission: "canApproveBilling" | "canManageBedgeBilling" | "canEnterBillAmounts" | "canViewBillingList"
  ) => {
    setPartners((prev) =>
      prev.map((partner) =>
        partner.id === id
          ? { ...partner, [permission]: !partner[permission] }
          : partner
      )
    );
  };

  // Tick or untick one Billing List for a partner
  const toggleListType = (id: string, type: BillTypeValue) => {
    setPartners((prev) =>
      prev.map((partner) =>
        partner.id === id
          ? {
              ...partner,
              billingListTypes: partner.billingListTypes.includes(type)
                ? partner.billingListTypes.filter((t) => t !== type)
                : BILL_TYPES.filter((t) => t === type || partner.billingListTypes.includes(t)),
            }
          : partner
      )
    );
  };

  // Save the updated permissions to the backend
  const handleSave = async () => {
    const empty = partners.find((p) => p.canViewBillingList && p.billingListTypes.length === 0);
    if (empty) {
      setError(`Tick at least one Billing List for ${empty.name}, or turn Billing List off.`);
      return;
    }
    try {
      setError(null);
      const updates = partners.map(
        ({ id, canApproveBilling, canManageBedgeBilling, canEnterBillAmounts, canViewBillingList, billingListTypes }) => ({
          id,
          canApproveBilling,
          canManageBedgeBilling,
          canEnterBillAmounts,
          canViewBillingList,
          // All ticked is saved as "all", so a new bill type is included too
          billingListTypes: billingListTypes.length === BILL_TYPES.length ? [] : billingListTypes,
        })
      );
      await axios.post("/api/admin/dashboard", { updates });
      setDialogOpen(true); // Open the dialog after successful save
    } catch (err) {
      console.error("Failed to update permissions:", err);
      setError("Failed to update permissions. Please try again later.");
    }
  };

  // Check if the user is an admin
  if (session?.user?.role !== "ADMIN") {
    return <p>Access denied. Only administrators can manage permissions.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Billing Permissions for Partners</CardTitle>
          <p className="text-sm text-muted-foreground">
            MVC billing managers handle MVC bills (GST and Non-GST); B Edge billing managers handle B Edge bills.
            They see amounts, choose the bill type and send bills for the amount. Bills can only be sent for the amount to
            partners with Can Enter Amounts on. Partners with Billing List on see the Billing Lists ticked for them
            (MVC &amp; Company GST, each Non-GST name, B Edge), download those bills and email them to clients, but
            can&apos;t change bills. A billing manager always sees the whole list of their company. Other partners see billing like any other staff.
            Admins can always do all of these.
          </p>
        </CardHeader>
        <CardContent>
          {error && <p className="text-red-500 mb-4">{error}</p>}
          {loading ? (
            <p>Loading...</p>
          ) : (
            <div className="space-y-4">
              {partners.length > 0 ? (
                <ResponsiveTable>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Avatar</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-center">MVC Billing Manager</TableHead>
                        <TableHead className="text-center">B Edge Billing Manager</TableHead>
                        <TableHead className="text-center">Can Enter Amounts</TableHead>
                        <TableHead className="text-center">Billing List</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {partners.map((partner) => (
                        <Fragment key={partner.id}>
                        <TableRow className={partner.canViewBillingList ? "border-b-0" : undefined}>
                          <TableCell>
                            <Avatar>
                              <AvatarImage src={partner.avatar || ""} alt={partner.name} />
                              <AvatarFallback>{partner.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                          </TableCell>
                          <TableCell>{partner.name}</TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={partner.canApproveBilling}
                              onCheckedChange={() => handleToggle(partner.id, "canApproveBilling")}
                              aria-label={`${partner.name}: MVC billing manager`}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={partner.canManageBedgeBilling}
                              onCheckedChange={() => handleToggle(partner.id, "canManageBedgeBilling")}
                              aria-label={`${partner.name}: B Edge billing manager`}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={partner.canEnterBillAmounts}
                              onCheckedChange={() => handleToggle(partner.id, "canEnterBillAmounts")}
                              aria-label={`${partner.name}: can enter amounts`}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={partner.canViewBillingList}
                              onCheckedChange={() => handleToggle(partner.id, "canViewBillingList")}
                              aria-label={`${partner.name}: sees the Billing List and emails bills`}
                            />
                          </TableCell>
                        </TableRow>
                        {partner.canViewBillingList && (
                          <TableRow>
                            <TableCell colSpan={6} className="pt-0">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                                <span className="font-medium">{partner.name} sees:</span>
                                {BILL_TYPES.map((type) => (
                                  <label key={type} className="flex items-center gap-1.5">
                                    <Checkbox
                                      checked={partner.billingListTypes.includes(type)}
                                      onCheckedChange={() => toggleListType(partner.id, type)}
                                    />
                                    {BILL_TYPE_LABELS[type]}
                                  </label>
                                ))}
                                {partner.billingListTypes.length === 0 && (
                                  <span className="text-destructive">Tick at least one</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </ResponsiveTable>
              ) : (
                <p>No partners found.</p>
              )}
              <div className="flex justify-end">
                <Button onClick={handleSave}>Save Changes</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog for Save Confirmation */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changes Saved</DialogTitle>
          </DialogHeader>
          <p>Your changes have been successfully saved.</p>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}