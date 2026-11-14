import { RoomPresenter } from "@/features/campus";

/** Presenter screen for an orientation or floor meeting. Tallies live in this tab only. */
export default function CampusRoomPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-8">
      <h1 className="sv-display text-3xl sm:text-4xl">Room tally</h1>
      <RoomPresenter />
    </main>
  );
}
