import { CaretDown } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import styles from "./faq.module.css";

/** A question; `text`: the answer as plain text, for structured data, when `a` has links or markup. */
export type FaqItem = { q: string; a: ReactNode; text?: string };

/** The answers as plain text (for faqData in lib/site.ts). */
export const faqPlain = (items: FaqItem[]) => items.map((i) => ({ q: i.q, text: i.text ?? (typeof i.a === "string" ? i.a : "") })).filter((i) => i.text);

/** Questions that open one at a time (`name` groups them). */
export function FaqList({ items, name, className }: { items: FaqItem[]; name: string; className?: string }) {
  return (
    <div className={className ? `${styles.list} ${className}` : styles.list}>
      {items.map((item) => (
        <details key={item.q} className={styles.item} name={name}>
          <summary>
            {item.q}
            <CaretDown size={18} weight="bold" aria-hidden />
          </summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
