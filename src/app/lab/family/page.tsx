import { FamilyBoard } from "@/features/family";
import { FamilyShare } from "@/features/family/FamilyShare";

/** Dev harness: a fictional scan result sharing a card, above the board that reads cards from the URL fragment. */
export default function FamilyLab() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 px-4 pb-24 pt-6 sm:px-6">
      <FamilyShare score={72} topFixTitle="Remove your phone number from people-search sites" chainsBroken={1} chainsTotal={3} />
      <FamilyBoard />
    </main>
  );
}
