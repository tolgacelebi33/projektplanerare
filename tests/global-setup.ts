// Sommartid i Sverige (CET/CEST) måste vara aktiv i testerna, annars bevisar krav 10 ingenting.
export default function setup() {
  process.env.TZ = "Europe/Stockholm";
}
