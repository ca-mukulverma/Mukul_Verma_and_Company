import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { contactsData, contactsError, contactsSchema } from "@/lib/client-contacts";
import { canSetTallyLedger } from "@/lib/connectors";
import { registrationsPayload, registrationsProblem, registrationsSchema } from "@/lib/client-documents";

// Client update validation schema
const clientUpdateSchema = contactsSchema.merge(registrationsSchema).extend({
  contactPerson: z.string().optional(),
  companyName: z.string().optional().nullable(),
  email: z.string().email("Invalid email").optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  isGuest: z.boolean().optional(),
  accessExpiry: z.string().optional().nullable(),
  connectorId: z.string().min(1).nullable().optional(),
  // Billing managers and Admin only
  tallyLedgerName: z.string().trim().max(100).nullable().optional(),
});

// GET specific client - keep accessible to all authenticated users
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const id = resolvedParams.id;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        connector: { select: { id: true, name: true, tallyLedgerName: true } },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(client);
  } catch (error) {
    console.error("Error fetching client:", error);
    return NextResponse.json(
      { error: "Failed to fetch client" },
      { status: 500 }
    );
  }
}

// PATCH update client - restrict to Admin only
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Admins and partners can edit clients; deleting stays with admins
    if (session.user.role !== "ADMIN" && session.user.role !== "PARTNER") {
      return NextResponse.json(
        { error: "Only administrators and partners can update clients" },
        { status: 403 }
      );
    }

    const resolvedParams = await params;
    const id = resolvedParams.id;

    // Get the existing client
    const existingClient = await prisma.client.findUnique({
      where: { id },
    });

    if (!existingClient) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    const data = await req.json();
    
    // Validate client data
    const validationResult = clientUpdateSchema.safeParse(data);
    
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid client data", details: validationResult.error.format() },
        { status: 400 }
      );
    }

    const input = validationResult.data;
    const contactProblem = contactsError(input);
    if (contactProblem) return NextResponse.json({ error: contactProblem }, { status: 400 });
    const registrationProblem = registrationsProblem(input);
    if (registrationProblem) return NextResponse.json({ error: registrationProblem }, { status: 400 });
    const contacts = contactsData(input);
    const mayLedger = await canSetTallyLedger(session.user.id);
    if (input.tallyLedgerName !== undefined && !mayLedger && (input.tallyLedgerName || null) !== existingClient.tallyLedgerName) {
      return NextResponse.json({ error: "Only the billing manager or Admin can set the Tally ledger" }, { status: 403 });
    }

    // Make sure at least one contact method exists after the update
    const willHaveEmail = data.email !== undefined ? data.email : existingClient.email;
    const willHavePhone = contacts.phone !== undefined ? contacts.phone : data.phone !== undefined ? data.phone : existingClient.phone;

    if (!willHaveEmail && !willHavePhone) {
      return NextResponse.json(
        { error: "At least one contact method (email or phone) is required" },
        { status: 400 }
      );
    }

    // Handle the potential date string to Date conversion
    let accessExpiry: Date | null | undefined = undefined;
    if (data.accessExpiry === null) {
      accessExpiry = null;
    } else if (data.accessExpiry) {
      accessExpiry = new Date(data.accessExpiry);
    }

    // Update client data
    const updatedClient = await prisma.client.update({
      where: { id },
      data: {
        contactPerson: data.contactPerson,
        companyName: data.companyName,
        email: data.email,
        phone: data.phone,
        ...contacts,
        address: data.address,
        notes: data.notes,
        gstin: data.gstin,
        ...registrationsPayload(input),
        isGuest: data.isGuest,
        accessExpiry,
        ...(input.connectorId !== undefined && { connectorId: input.connectorId }),
        ...(mayLedger &&
          input.tallyLedgerName !== undefined && { tallyLedgerName: input.tallyLedgerName || null, tallyLedgerPending: false }),
      },
    });

    // Log the activity
    await prisma.activity.create({
      data: {
        type: "client",
        action: "updated",
        target: updatedClient.contactPerson,
        userId: session.user.id,
      },
    });

    return NextResponse.json(updatedClient);
  } catch (error) {
    console.error("Error updating client:", error);
    return NextResponse.json(
      { error: "Failed to update client" },
      { status: 500 }
    );
  }
}

// DELETE client - restrict to Admin only
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Add role-based access control
    if (session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only administrators can delete clients" },
        { status: 403 }
      );
    }

    const resolvedParams = await params;
    const id = resolvedParams.id;

    // Get client name for activity log
    const client = await prisma.client.findUnique({
      where: { id },
      select: { contactPerson: true, isGuest: true },
    });

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // Delete related records in ClientHistory first
    await prisma.clientHistory.deleteMany({
      where: { clientId: id }, // Fix: Use clientId to delete related records
    });

    // Delete the client
    await prisma.client.delete({
      where: { id },
    });

    // Log the activity
    await prisma.activity.create({
      data: {
        type: "client",
        action: "deleted",
        target: `${client.isGuest ? "Guest" : "Permanent"} client: ${client.contactPerson}`,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting client:", error);
    return NextResponse.json(
      { error: "Failed to delete client", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}