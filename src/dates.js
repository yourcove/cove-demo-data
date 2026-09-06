export function parseExactDate(value, label = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new Error(`${label} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a valid calendar date`);
  return date;
}

export function ageOnDate(birthDate, depictsDate) {
  const birth = parseExactDate(birthDate, "birth date");
  const depicted = parseExactDate(depictsDate, "depicts date");
  let age = depicted.getUTCFullYear() - birth.getUTCFullYear();
  if (depicted.getUTCMonth() < birth.getUTCMonth() || (depicted.getUTCMonth() === birth.getUTCMonth() && depicted.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}
