// Compile every contract into a fresh simnet and report analysis failures.
// Stands in for `clarinet check` when the Clarinet binary is not installed.
import { initSimnet } from "@stacks/clarinet-sdk";

try {
  const simnet = await initSimnet();
  const ids = [...simnet.getContractsInterfaces().keys()];
  console.log("OK - all contracts deployed and analysed:");
  ids.forEach((i) => console.log("  " + i));
  console.log("\naccounts:   " + [...simnet.getAccounts().keys()].join(", "));
  console.log("burn height: " + simnet.burnBlockHeight);
} catch (e) {
  console.error("FAILED:\n" + (e?.message ?? e));
  process.exit(1);
}
