import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ProfileView } from "./profile-view";
import styles from "./profile.module.css";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <>
      <AppHeader />
      <main id="main" className={`container ${styles.page}`}>
        <div className={styles.head}>
          <h1 className="t-heading-xl">Profile</h1>
          <p className="t-secondary">Your name, photo, sign-in methods and the defaults every new video starts with.</p>
        </div>
        <ProfileView />
      </main>
    </>
  );
}
