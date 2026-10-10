import { useRef, useState } from "react";
import { GRID_WIDTH } from "../layout";
import { sv } from "../i18n/sv";

/** Rad under rutnätet för att lägga till uppgifter snabbt: skriv, tryck Enter och fortsätt. Fokus ligger kvar i fältet. */
export function QuickAdd({ onAdd, disabled }: { onAdd: (title: string) => Promise<unknown>; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const busy = useRef(false);
  const submit = async () => {
    const title = value.trim();
    if (!title || busy.current || disabled) return;
    busy.current = true;
    try { await onAdd(title); setValue(""); } finally { busy.current = false; }
  };
  return (
    <div className="quick-add">
      <input aria-label={sv.quick.label} placeholder={sv.quick.placeholder} value={value} maxLength={250} disabled={disabled} style={{ width: GRID_WIDTH - 16 }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } if (e.key === "Escape" && value) { e.stopPropagation(); setValue(""); } }} />
    </div>
  );
}
