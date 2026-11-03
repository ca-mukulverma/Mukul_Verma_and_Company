-- Attendance: staff mark themselves present once a day on Today
ALTER TABLE "User" ADD COLUMN "marksAttendance" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Attendance" (
    "id" CHAR(36) NOT NULL,
    "userId" CHAR(36) NOT NULL,
    "date" DATE NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
