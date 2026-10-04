import { redirect } from "next/navigation";

export default async function OrgIndex(props: PageProps<"/o/[org]">) {
  const { org } = await props.params;
  redirect(`/o/${org}/calendar`);
}
