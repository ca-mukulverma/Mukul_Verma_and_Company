import { prisma } from "@/lib/prisma";
// Add this import at the top of the file
import { getTaskAssignmentTemplate, getTaskReassignedTemplate } from "../../emails/templates/task-templates";
// Remove or comment this import since it's causing errors
// import { sendWhatsAppMessage } from './email';
import { sendWhatsAppNotification } from "./whatsapp";
import { sendActivityNotificationEmail } from "./email";
import { sendPushForNotification } from "./web-push";


interface NotificationOptions {
  title: string;
  content: string;
  sentById: string;
  sentToId: string;
  taskId?: string; // Added taskId property
  sendEmail?: boolean;
  emailSubject?: string;
  emailHtml?: string; // Added emailHtml property
  sendWhatsApp?: boolean;
}

// Email and WhatsApp for task activity are switched off: users get the in-app
// notification and a phone (push) notification only. Set
// ENABLE_TASK_EMAIL_WHATSAPP=true to turn them back on. Password emails are
// sent from lib/email.ts directly and are not affected by this switch.
export const TASK_EMAIL_WHATSAPP_ENABLED =
  process.env.ENABLE_TASK_EMAIL_WHATSAPP === "true";

// How long notifications are kept before the nightly cleanup removes them
export const NOTIFICATION_RETENTION_DAYS = 90;

// Called from the nightly cron job (not on every new notification, which
// used to slow down every task action)
export async function deleteOldNotifications(
  olderThanDays: number = NOTIFICATION_RETENTION_DAYS
) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

// Run one notification job per recipient at the same time instead of one
// after another; a failure for one recipient doesn't stop the others.
async function notifyEach<T>(items: T[], send: (item: T) => Promise<unknown>) {
  const results = await Promise.allSettled(items.map(send));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to send notification:", result.reason);
    }
  }
}

// Save an in-app notification and push it to the user's phone.
// Never throws, so one failure doesn't stop the other notifications.
export async function sendInAppNotification(data: {
  title: string;
  content: string;
  sentById: string;
  sentToId: string;
  taskId?: string;
}) {
  try {
    const notification = await prisma.notification.create({ data });
    await sendPushForNotification(notification);
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}


export async function createNotification({
  title,
  content,
  sentById,
  sentToId,
  taskId,
  sendEmail = false,
  emailSubject,
  sendWhatsApp = false,
}: NotificationOptions) {
  try {
    
    const notification = await prisma.notification.create({
      data: {
        title,
        content,
        sentById,
        sentToId,
        taskId,
      },
      include: {
        sentTo: true,
      },
    });

    // Push to the user's phone / installed app
    await sendPushForNotification(notification);

    // Send email if requested
    if (TASK_EMAIL_WHATSAPP_ENABLED && sendEmail && notification.sentTo.email) {
      try {
        await sendActivityNotificationEmail(
          notification.sentTo.email,
          notification.sentTo.name || "User",
          emailSubject || title,
          content
        );
        console.log("Email sent successfully");
      } catch (error) {
        console.error("Failed to send email:", error);
      }
    }

    if (TASK_EMAIL_WHATSAPP_ENABLED && sendWhatsApp && notification.sentTo.phone) {
      try {
        // Fetch the assigner's name
        const assigner = await prisma.user.findUnique({
          where: { id: sentById },
        });
    
        if (!assigner) {
          throw new Error("Assigner not found");
        }
    
        // Handle task details
        let taskDetails = {
          title: "No title provided",
          note: "No additional note provided",
          dueDate: "No due date",
        };
    
        if (taskId) {
          const task = await prisma.task.findUnique({
            where: { id: taskId },
          });
    
          if (task) {
            taskDetails = {
              title: task.title || "No title provided",
              note: task.description || "No additional note provided",
              dueDate: task.dueDate
                ? new Date(task.dueDate).toLocaleDateString()
                : "No due date",
            };
          }
        }
    
        // Define variables as an ordered array for numbered placeholders
        const variables = [
          taskDetails.title, // {{1}}
          assigner.name || "Unknown", // {{2}}
          taskDetails.note, // {{3}}
          taskDetails.dueDate, // {{4}}
        ];
    
        // Call the WhatsApp notification function
        await sendWhatsAppNotification(notification.sentTo.phone, "new_task", variables);
        console.log("WhatsApp notification sent successfully");
      } catch (error) {
        console.error("Failed to send WhatsApp notification:", error instanceof Error ? error.message : error);
      }
    }


    return notification;
  } catch (error) {
    console.error("Failed to create notification:", error);
    throw error;
  }
}

// Rest of your notification functions remain unchanged
export async function sendTaskAssignedNotification(
  taskId: string,
  taskTitle: string,
  assignerUserId: string,
  assigneeUserId: string,
  note?: string,
  dueDate?: Date,
) {
  try {
    // Get user details
    const [assigner, assignee] = await Promise.all([
      prisma.user.findUnique({ where: { id: assignerUserId } }),
      prisma.user.findUnique({ where: { id: assigneeUserId } })
    ]);

    if (!assigner || !assignee) {
      throw new Error("User not found");
    }

    // Create notification
    const notificationContent = `${assigner.name} assigned you a task: ${taskTitle}${
      note ? ` - Note: ${note}` : ""
    } [taskId: ${taskId}]`;

    const emailHtml = getTaskAssignmentTemplate(
      taskTitle,
      assigner.name,
      note,
      dueDate
    );

    await createNotification({
      title: "New Task Assigned",
      content: notificationContent,
      sentById: assignerUserId,
      sentToId: assigneeUserId,
      taskId,
      sendEmail: true,
      emailSubject: `Task Assigned:${taskTitle}`,
      emailHtml,
      sendWhatsApp: !!assignee.phone,
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: "task",
        action: "assigned",
        target: taskTitle,
        details: { taskId },
        userId: assignerUserId,
      },
    });
  } catch (error) {
    console.error("Failed to send task assignment notification:", error);
  }
}

export async function sendTaskReassignedNotification(
  taskId: string,
  taskTitle: string,
  reassignerUserId: string,
  previousAssigneeId: string | null,
  newAssigneeId: string
) {
  try {
    // Get user details
    const [reassigner, newAssignee] = await Promise.all([
      prisma.user.findUnique({ where: { id: reassignerUserId } }),
      prisma.user.findUnique({ where: { id: newAssigneeId } })
    ]);

    if (!reassigner || !newAssignee) {
      throw new Error("User not found");
    }

    await createNotification({
      title: "New Task Assigned",
      content: `${reassigner.name} reassigned the task "${taskTitle}" to you. [taskId:${taskId}]`,
      taskId,
      sentById: reassignerUserId,
      sentToId: newAssigneeId,
      sendEmail: true,
      emailSubject: `Task Assigned: ${taskTitle}`,
      emailHtml: getTaskAssignmentTemplate(taskTitle, reassigner.name),
      sendWhatsApp: !!newAssignee.phone,
    });

    // If there was a previous assignee, notify them as well
    if (previousAssigneeId && previousAssigneeId !== newAssigneeId) {
      const previousAssignee = await prisma.user.findUnique({
        where: { id: previousAssigneeId }
      });

      if (previousAssignee) {
        await createNotification({
          title: "Task Reassigned",
          content: `Your task "${taskTitle}" has been reassigned to ${newAssignee.name}.`,
          sentById: reassignerUserId,
          sentToId: previousAssigneeId,
          sendEmail: true,
          emailSubject: `Task Reassigned: ${taskTitle}`,
          emailHtml: getTaskReassignedTemplate(taskTitle, newAssignee.name),
          sendWhatsApp: !!previousAssignee.phone,
        });
      }
    }

    // Log activity
    await prisma.activity.create({
      data: {
        type: "task",
        action: "reassigned",
        target: taskTitle,
        details: {
          taskId,
          previousAssigneeId,
          newAssigneeId,
        },
        userId: reassignerUserId,
      },
    });
  } catch (error) {
    console.error("Failed to send task reassignment notification:", error);
  }
}

export async function sendTaskStatusUpdateNotification(
  taskId: string,
  taskTitle: string,
  updaterUserId: string,
  creatorUserId: string,
  oldStatus: string,
  newStatus: string
) {
  try {
    // Skip notification if updater is also the creator
    if (updaterUserId === creatorUserId) {
      return;
    }

    // Get user details
    const [updater, creator] = await Promise.all([
      prisma.user.findUnique({ where: { id: updaterUserId } }),
      prisma.user.findUnique({ where: { id: creatorUserId } }),
    ]);

    if (!updater || !creator) {
      throw new Error("User not found");
    }

    // Create notification
    const notificationTitle = "Task Status Updated";
    const notificationContent = `${updater.name} changed task "${taskTitle}" status from ${oldStatus} to ${newStatus} [taskId: ${taskId}]`;

    // Email HTML
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Task Status Updated</h2>
        <p><strong>Task:</strong> ${taskTitle}</p>
        <p><strong>Status change:</strong> ${oldStatus} → ${newStatus}</p>
        <p><strong>Updated by:</strong> ${updater.name}</p>
        <p>Log in to the system to view task details.</p>
        <p>Thank you,<br>Office Management Team</p>
      </div>
    `;

    await createNotification({
      title: notificationTitle,
      content: notificationContent,
      sentById: updaterUserId,
      sentToId: creatorUserId,
      taskId,
      sendEmail: true,
      emailSubject: `Task Status Update: ${taskTitle}`,
      emailHtml,
      sendWhatsApp: !!creator.phone,
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: "task",
        action: "status_changed",
        target: taskTitle,
        details: {
          taskId,
          oldStatus,
          newStatus,
        },
        userId: updaterUserId,
      },
    });
  } catch (error) {
    console.error("Failed to send task status update notification:", error);
  }
}



// When a task is allotted to someone else: tells everyone concerned in one
// go – the new assignees, the ones taken off, those still on it, the person
// who created the task and the Admins. The person allotting it is skipped.
export async function sendTaskAllotmentNotifications({
  taskId,
  taskTitle,
  actor,
  creatorId,
  previousAssigneeIds,
  newAssigneeIds,
  note,
}: {
  taskId: string;
  taskTitle: string;
  actor: { id: string; name: string };
  creatorId: string;
  previousAssigneeIds: string[];
  newAssigneeIds: string[];
  note?: string;
}) {
  const nextIds = [...new Set(newAssigneeIds)];
  const added = nextIds.filter((id) => !previousAssigneeIds.includes(id));
  const removed = previousAssigneeIds.filter((id) => !nextIds.includes(id));
  if (added.length === 0 && removed.length === 0) return;
  const kept = nextIds.filter((id) => previousAssigneeIds.includes(id));

  try {
    const [users, admins] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: [...nextIds, ...removed] } },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } }),
    ]);
    const names = (ids: string[]) =>
      ids.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(", ") || "nobody";
    const noteText = note ? ` - Note: ${note}` : "";
    const ref = ` [taskId: ${taskId}]`;

    const messages = new Map<string, { title: string; content: string }>();
    for (const id of added) {
      messages.set(id, {
        title: "New Task Assigned",
        content: `${actor.name} assigned you a task: ${taskTitle}${noteText}${ref}`,
      });
    }
    for (const id of removed) {
      messages.set(id, {
        title: "Task Reassigned",
        content: `${actor.name} reassigned your task "${taskTitle}" to ${names(nextIds)}${ref}`,
      });
    }
    for (const id of kept) {
      messages.set(id, {
        title: "Task Assignees Changed",
        content: `${actor.name} changed who is working on "${taskTitle}": now ${names(nextIds)}${noteText}${ref}`,
      });
    }
    // The task's creator and the Admins, unless already told above
    const allotted =
      `${actor.name} allotted the task "${taskTitle}" to ${names(nextIds)}` +
      (removed.length > 0 ? ` (taken off: ${names(removed)})` : "") +
      `${noteText}${ref}`;
    for (const id of [creatorId, ...admins.map((a) => a.id)]) {
      if (!messages.has(id)) messages.set(id, { title: "Task Allotted", content: allotted });
    }
    messages.delete(actor.id);

    await notifyEach([...messages], ([sentToId, message]) =>
      sendInAppNotification({ ...message, taskId, sentById: actor.id, sentToId })
    );
  } catch (error) {
    console.error("Failed to send task allotment notifications:", error);
  }
}

// Add this function after the other notification functions only for admins

export async function sendTaskCreatedNotificationToAdmins(
  taskId: string,
  taskTitle: string,
  creatorUserId: string
) {
  try {
    // Get creator details
    const creator = await prisma.user.findUnique({ 
      where: { id: creatorUserId } 
    });

    if (!creator) {
      throw new Error("Creator user not found");
    }

    // Find all admin users except the creator
    const adminUsers = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        NOT: {
          id: creatorUserId
        }
      }
    });

    // Notify all admins at the same time
    await notifyEach(adminUsers, (admin) =>
      createNotification({
        title: "New Task Created",
        content: `${creator.name} created a new task: ${taskTitle} [taskId: ${taskId}]`,
        sentById: creatorUserId,
        sentToId: admin.id,
        taskId,
        sendEmail: true,
        emailSubject: `New Task Created: ${taskTitle}`,
        emailHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>New Task Created</h2>
            <p><strong>Task:</strong> ${taskTitle}</p>
            <p><strong>Created by:</strong> ${creator.name}</p>
            <p>Log in to the system to view task details.</p>
            <p>Thank you,<br>Office Management Team</p>
          </div>
        `,
        sendWhatsApp: !!admin.phone,
      })
    );
  } catch (error) {
    console.error("Failed to send task creation notification to admins:", error);
  }
}

// Add this new function after your other notification functions only for admins

export async function sendTaskCommentNotificationToAdmins(
  taskId: string,
  taskTitle: string,
  commenterId: string,
  taskCreatorId: string,
  comment: { content: string }
) {
  try {
    // Get commenter details
    const commenter = await prisma.user.findUnique({
      where: { id: commenterId }
    });

    if (!commenter) {
      throw new Error("Commenter user not found");
    }

    // Find all admin users except the task creator (if they're an admin)
    const adminUsers = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        NOT: {
          // Exclude both the commenter and the task creator
          OR: [
            { id: taskCreatorId },
            { id: commenterId }
          ]
        }
      }
    });

    // Notify all admins at the same time
    await notifyEach(adminUsers, (admin) =>
      createNotification({
        title: "New Comment on Task",
        content: `${commenter.name} commented on task: ${taskTitle} - "${comment.content}"  [taskId: ${taskId}]`,
        sentById: commenterId,
        sentToId: admin.id,
        taskId,
        sendEmail: true,
        emailSubject: `New Comment on Task: ${taskTitle}`,
        emailHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>New Comment on Task</h2>
            <p><strong>Task:</strong> ${taskTitle}</p>
            <p><strong>Comment by:</strong> ${commenter.name}</p>
            <p><strong>Comment:</strong> ${comment.content}</p>
            <p>Log in to the system to view the comment and task details.</p>
            <p>Thank you,<br>Office Management Team</p>
          </div>
        `,
        sendWhatsApp: !!admin.phone,
      })
    );
  } catch (error) {
    console.error("Failed to send comment notification to admins:", error);
  }
}

// Add this function after your other notification functions for adming

export async function sendTaskUpdatedNotificationToAdmins(
  taskId: string,
  taskTitle: string,
  updaterUserId: string
) {
  try {
    // Get updater details
    const updater = await prisma.user.findUnique({ 
      where: { id: updaterUserId } 
    });

    if (!updater) {
      throw new Error("Updater user not found");
    }

    // Find all admin users except the updater
    const adminUsers = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        NOT: {
          id: updaterUserId
        }
      }
    });

    // Notify all admins at the same time
    await notifyEach(adminUsers, (admin) =>
      createNotification({
        title: "Task Updated",
        content: `${updater.name} updated task: ${taskTitle} [taskId: ${taskId}]`,
        sentById: updaterUserId,
        sentToId: admin.id,
        taskId,
        sendEmail: true,
        emailSubject: `Task Updated: ${taskTitle}`,
        emailHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>Task Updated</h2>
            <p><strong>Task:</strong> ${taskTitle}</p>
            <p><strong>Updated by:</strong> ${updater.name}</p>
            <p>Log in to the system to view the updated task details.</p>
            <p>Thank you,<br>Office Management Team</p>
          </div>
        `,
        sendWhatsApp: !!admin.phone,
      })
    );
  } catch (error) {
    console.error("Failed to send task update notification to admins:", error);
  }
}
