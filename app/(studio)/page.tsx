import { redirect } from "next/navigation";

// The studio starts on Generate
export default function StudioHome() {
  redirect("/generate");
}
