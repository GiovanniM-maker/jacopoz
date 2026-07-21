import { ScrollView, StyleSheet, Text } from "react-native";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, spacing, typography } from "@/theme";

/** Privacy policy — DRAFT: have it reviewed by a lawyer before public launch. */
export default function Privacy() {
  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Privacy" backFallback="/settings" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Informativa sulla privacy · aggiornata al 21 luglio 2026 · BOZZA</Text>

        <Text style={styles.h}>Chi siamo</Text>
        <Text style={styles.p}>
          Tomo è un'app per scoprire libri e condividere recensioni. Titolare del trattamento:
          il gestore di Tomo (contatto: vedi sotto). Questa informativa spiega quali dati
          trattiamo e perché, ai sensi del Regolamento (UE) 2016/679 ("GDPR").
        </Text>

        <Text style={styles.h}>Quali dati raccogliamo</Text>
        <Text style={styles.p}>
          • Dati dell'account: email, nome utente, nome visualizzato, biografia e immagine del
          profilo.{"\n"}
          • Contenuti che crei: recensioni, commenti, valutazioni, liste, like, follow e
          segnalazioni.{"\n"}
          • Dati d'uso: eventi tecnici essenziali (es. apertura del feed, ricerche, visite alle
          schede libro) usati per far funzionare e migliorare i suggerimenti.{"\n"}
          • Non raccogliamo dati di pagamento né dati di localizzazione.
        </Text>

        <Text style={styles.h}>Perché li trattiamo</Text>
        <Text style={styles.p}>
          Per fornire il servizio (esecuzione del contratto): account, contenuti, funzioni
          social. Per migliorare i suggerimenti di lettura (legittimo interesse): i tuoi
          segnali di lettura alimentano l'algoritmo di raccomandazione interno. Non vendiamo i
          tuoi dati e non facciamo pubblicità profilata.
        </Text>

        <Text style={styles.h}>Dove stanno i dati</Text>
        <Text style={styles.p}>
          I dati sono ospitati su Supabase (database nell'Unione Europea, regione Irlanda) e
          l'app è distribuita tramite Vercel. Per generare le rappresentazioni semantiche del
          catalogo (non dei tuoi dati personali) usiamo servizi di terze parti; i testi
          inviati riguardano i libri, non gli utenti.
        </Text>

        <Text style={styles.h}>Per quanto tempo</Text>
        <Text style={styles.p}>
          Finché il tuo account esiste. Puoi eliminare l'account (e tutti i tuoi dati) in
          autonomia da Impostazioni → Elimina account: la cancellazione è immediata e
          irreversibile.
        </Text>

        <Text style={styles.h}>I tuoi diritti</Text>
        <Text style={styles.p}>
          Hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e
          opposizione. Molti sono esercitabili direttamente in app; per il resto scrivici.
          Hai anche diritto di reclamo al Garante per la protezione dei dati personali.
        </Text>

        <Text style={styles.h}>Contatti</Text>
        <Text style={styles.p}>
          Per qualsiasi richiesta sulla privacy: [inserire email di contatto].
        </Text>

        <Text style={styles.note}>
          Nota interna: questa è una bozza operativa. Prima del lancio pubblico va completata
          con i dati del titolare e revisionata legalmente.
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
