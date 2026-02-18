import { format } from "date-fns";

function easterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function getBrazilHolidays(year: number) {
  const easter = easterDate(year);
  const carnival = new Date(easter);
  carnival.setDate(easter.getDate() - 47);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  const corpusChristi = new Date(easter);
  corpusChristi.setDate(easter.getDate() + 60);

  return [
    { title: "Confraternização Universal", date: `${year}-01-01` },
    { title: "Carnaval", date: iso(carnival) },
    { title: "Sexta-feira Santa", date: iso(goodFriday) },
    { title: "Tiradentes", date: `${year}-04-21` },
    { title: "Dia do Trabalho", date: `${year}-05-01` },
    { title: "Corpus Christi", date: iso(corpusChristi) },
    { title: "Independência do Brasil", date: `${year}-09-07` },
    { title: "Nossa Senhora Aparecida", date: `${year}-10-12` },
    { title: "Finados", date: `${year}-11-02` },
    { title: "Proclamação da República", date: `${year}-11-15` },
    { title: "Natal", date: `${year}-12-25` },
  ];
}
