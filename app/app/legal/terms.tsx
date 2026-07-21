import { ScrollView, StyleSheet, Text } from "react-native";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, spacing, typography } from "@/theme";

/** Terms of service — DRAFT: have it reviewed by a lawyer before public launch. */
export default function Terms() {
  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Termini" backFallback="/settings" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Termini di servizio · aggiornati al 21 luglio 2026 · BOZZA</Text>

        <Text style={styles.h}>Il servizio</Text>
        <Text style={styles.p}>
          Tomo è una community per scoprire libri, scrivere recensioni e seguire altri
          lettori. Il servizio è in fase beta: può cambiare, avere interruzioni o errori.
        </Text>

        <Text style={styles.h}>Il tuo account</Text>
        <Text style={styles.p}>
          Devi avere almeno 16 anni. Sei responsabile della custodia delle tue credenziali e
          di ciò che pubblichi. Un account a testa, niente impersonificazioni.
        </Text>

        <Text style={styles.h}>I tuoi contenuti</Text>
        <Text style={styles.p}>
          Recensioni, commenti e liste restano tuoi. Pubblicandoli concedi a Tomo una licenza
          non esclusiva a mostrarli nell'app (è ciò che serve per farli vedere agli altri
          lettori). Puoi cancellarli quando vuoi; eliminando l'account si cancella tutto.
        </Text>

        <Text style={styles.h}>Cosa non è permesso</Text>
        <Text style={styles.p}>
          Contenuti illegali, odio, molestie, spam, spoiler deliberatamente non segnalati con
          l'apposita opzione, violazioni di copyright (es. copiare recensioni altrui),
          manipolazione di like o valutazioni.
        </Text>

        <Text style={styles.h}>Moderazione</Text>
        <Text style={styles.p}>
          Gli utenti possono segnalare contenuti e bloccare altri utenti. Contenuti segnalati
          da più persone vengono nascosti automaticamente in attesa di verifica. Possiamo
          rimuovere contenuti o sospendere account che violano questi termini.
        </Text>

        <Text style={styles.h}>Responsabilità</Text>
        <Text style={styles.p}>
          Le recensioni esprimono opinioni dei rispettivi autori. Il servizio è fornito "così
          com'è", senza garanzie, nei limiti consentiti dalla legge. I link d'acquisto
          (quando presenti) possono essere link di affiliazione.
        </Text>

        <Text style={styles.h}>Modifiche e contatti</Text>
        <Text style={styles.p}>
          Potremo aggiornare questi termini; le modifiche rilevanti saranno comunicate in
          app. Domande: [inserire email di contatto].
        </Text>

        <Text style={styles.note}>
          Nota interna: bozza operativa, da completare con i dati del titolare e revisionare
          legalmente prima del lancio pubblico.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  updated: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.lg,
  },
  h: {
    fontFamily: displayFont,
    fontSize: 18,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  p: { ...typography.body, lineHeight: 22 },
  note: {
    ...typography.caption,
    marginTop: spacing.xl,
    fontStyle: "italic",
  },
});
