import type { DataStore } from "./DataStore";
import { inOneStep } from "./actions";
import { pruneView } from "./fields";
import type { FieldDef, Item, Project } from "./types";

/** Tar bort ett eget fält: definitionen, värdena på alla poster, och fältet ur sparade vyer. Ett enda ångra-steg. */
export async function removeFieldDef(store: DataStore, project: Project, fieldId: string): Promise<void> {
  const items: Item[] = await store.listItems(project.id); // alltid det som är sparat, inte vad vyn visar just nu
  const defs = (project.fields ?? []).filter((d) => d.id !== fieldId);
  const ids = new Set(defs.map((d) => d.id));
  await inOneStep(store, async () => {
    await store.updateProject(project.id, { fields: defs, ...(project.views ? { views: project.views.map((v) => pruneView(v, ids)) } : {}) });
    for (const it of items) {
      if (it.fields && fieldId in it.fields) {
        const { [fieldId]: _gone, ...rest } = it.fields; void _gone;
        await store.updateItem(it.id, { fields: Object.keys(rest).length ? rest : undefined });
      }
    }
  });
}

/** Ändrar ett fälts definition (namn, val, visa på kort). Typen och id ändras inte. */
export async function changeFieldDef(store: DataStore, project: Project, def: FieldDef): Promise<void> {
  await store.updateProject(project.id, { fields: (project.fields ?? []).map((d) => (d.id === def.id ? def : d)) });
}
