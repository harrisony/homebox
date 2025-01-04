import { addDays } from "date-fns";

export function zeroTime(date: Date): Date {
  return new Date(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - date.getTimezoneOffset() * 60000
  );
}

export function factorRange(offset: number = 7): [Date, Date] {
  const date = zeroTime(new Date());

  return [date, addDays(date, offset)];
}

export function factory(offset = 0): Date {
  if (offset) {
    return addDays(zeroTime(new Date()), offset);
  }

  return zeroTime(new Date());
}
