-- What's new: which announcements' push has gone out (sent once only)
CREATE TABLE "AnnouncementPush" (
    "id" VARCHAR(50) NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementPush_pkey" PRIMARY KEY ("id")
);
