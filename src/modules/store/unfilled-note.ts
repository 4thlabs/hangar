/** The warning a start or deploy confirmation carries when the app would start with empty variables. */
export class UnfilledNote {
  /** The toast title when the variables could not be read, so nothing starts blind. */
  static readonly CheckFailedTitle = "Variables illisibles";

  /**
   * One sentence naming the empty variables, or nothing when there is none.
   * @param variables The app's variables still empty in `.env.global`
   */
  static describe(variables: readonly string[]) {
    if (variables.length === 0) {
      return "";
    }

    return ` Ces variables sont encore vides dans .env.global : ${variables.join(", ")}. Renseignez-les dans Paramètres → Environnement, ou continuez si l’app s’en passe.`;
  }
}
