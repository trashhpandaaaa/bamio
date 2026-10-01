import styles from "./scene.module.css";

/*
 * Stand-in footage for the landing page's demos: a two-person podcast set drawn with shapes
 * (no real video or photos to show). Always inside a .studio surface.
 */

function Person({ side }: { side: "left" | "right" }) {
  return (
    <span className={`${styles.person} ${styles[side]}`}>
      <span className={styles.body} />
      <span className={styles.head} />
      <span className={styles.phones} />
    </span>
  );
}

/** The wide (16:9) shot. Fills its parent. */
export function Scene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <span className={styles.sign} />
      <span className={styles.key} />
      <Person side="left" />
      <Person side="right" />
      <span className={styles.desk} />
      <span className={`${styles.mic} ${styles.micLeft}`} />
      <span className={`${styles.mic} ${styles.micRight}`} />
    </div>
  );
}

/**
 * A vertical (9:16) crop of the wide shot, centred on `focus` (0 = left edge, 1 = right edge),
 * the way Bamio reframes a clip. Fills its parent, which should be 9:16.
 */
export function SceneCrop({ focus }: { focus: number }) {
  return (
    <div className={styles.crop} aria-hidden="true">
      <div className={styles.cropInner} style={{ ["--focus" as string]: focus }}>
        <Scene />
      </div>
    </div>
  );
}
