// A calendar invite (.ics) is a small, plain-text format — RFC 5545. This
// hand-writes the minimal subset needed for a single-day, all-day event
// (site + inspection type + assigned inspector), rather than pulling in a
// dependency for something this small. Any calendar app (Outlook, Gmail,
// Apple Calendar, phone calendars) opens this and drops it straight in.

function foldLine(line: string): string {
  // RFC 5545 requires long lines folded at 75 octets with a leading space
  // on the continuation. Our lines are short in practice, but this keeps
  // the generator correct if a site name or note ever runs long.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcsDate(date: string): string {
  // Expects 'YYYY-MM-DD' — produces the all-day VALUE=DATE format YYYYMMDD.
  return date.replace(/-/g, '');
}

export type IcsEventInput = {
  uid: string; // stable id, e.g. the scheduled_inspections row id
  title: string;
  description?: string;
  date: string; // 'YYYY-MM-DD', all-day event
  organizerEmail: string;
  attendeeEmail?: string;
};

export function buildIcsEvent(input: IcsEventInput): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dtstart = toIcsDate(input.date);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RSLQLD Inspection App//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${input.uid}@inspection-app-virid.vercel.app`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `SUMMARY:${escapeText(input.title)}`,
    input.description ? `DESCRIPTION:${escapeText(input.description)}` : null,
    `ORGANIZER:mailto:${input.organizerEmail}`,
    input.attendeeEmail
      ? `ATTENDEE;RSVP=TRUE;CN=${escapeText(input.attendeeEmail)}:mailto:${input.attendeeEmail}`
      : null,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line): line is string => line !== null);

  return lines.map(foldLine).join('\r\n');
}
