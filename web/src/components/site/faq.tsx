import { CaretDown } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import styles from "./faq.module.css";

export type FaqItem = { q: string; a: ReactNode };

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
