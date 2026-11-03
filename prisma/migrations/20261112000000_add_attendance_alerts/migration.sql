-- Selected partners get a "came to office" notification when attendance is marked
ALTER TABLE "User" ADD COLUMN "attendanceAlerts" BOOLEAN NOT NULL DEFAULT false;
