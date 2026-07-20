import { db, transaction } from "./db.js";

type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

interface SeedAccount {
  name: string;
  type: AccountType;
  children?: string[];
}

const seedTree: SeedAccount[] = [
  { name: "Aktiva", type: "asset", children: ["Girokonto", "Bargeld", "Sparkonto"] },
  { name: "Passiva", type: "liability", children: ["Kreditkarte"] },
  { name: "Eigenkapital", type: "equity", children: ["Eröffnungsbilanz"] },
  { name: "Erträge", type: "income", children: ["Gehalt", "Sonstige Einnahmen"] },
  {
    name: "Aufwendungen",
    type: "expense",
    children: [
      "Wohnen",
      "Lebensmittel",
      "Transport",
      "Freizeit & Hobby",
      "Versicherungen",
      "Gesundheit",
      "Sonstiges",
    ],
  },
];

export function seedIfEmpty() {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM accounts").get() as { c: number }).c;
  if (count > 0) return;

  const insertAccount = db.prepare(
    "INSERT INTO accounts (name, type, parent_id) VALUES (?, ?, ?)"
  );

  transaction(() => {
    for (const root of seedTree) {
      const rootId = insertAccount.run(root.name, root.type, null).lastInsertRowid;
      for (const childName of root.children ?? []) {
        insertAccount.run(childName, root.type, rootId as number);
      }
    }
  });

  console.log("Default-Kontenrahmen wurde angelegt.");
}
