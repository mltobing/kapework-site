/**
 * views/uitleg.js
 *
 * /uitleg — "Uitleg & veelgestelde vragen". A permanent, static help page
 * explaining what each tab does and how the family should use it. Reached
 * from the top-right menu's "Hulp" section; available to every signed-in
 * accessType (owner/member/caregiver) since it holds no private family data.
 *
 * Deliberately static content, not fetched from anywhere — nothing here can
 * leak a name, a date, or an appointment. Update this file by hand when a
 * described behavior changes.
 */

const SECTIONS = [
  {
    id: 'snel-beginnen',
    title: 'Snel beginnen',
    items: [
      ['Wat is Ma?', 'Ma is een privé-app voor de familie: een gedeelde agenda, een logboek met notities en foto’s, en een dagelijkse briefing — allemaal rond de dagelijkse zorg voor één familielid.'],
      ['Voor wie is de app bedoeld?', 'Voor familieleden (eigenaar of familielid) en, waar van toepassing, een actief zorgteamlid. De persoon om wie het gaat heeft geen account nodig — die krijgt een eenvoudig gekoppeld scherm bij Vandaag, zonder inloggen.'],
      ['Welke informatie ziet iedere gebruiker?', 'Een eigenaar of familielid ziet alles: Vandaag, Briefing, het volledige Logboek en de Agenda. Een zorgteamlid ziet alleen Vandaag en de Logboekregels die uitdrukkelijk met het zorgteam zijn gedeeld — geen Briefing, geen Agenda, geen Beheer. Het gekoppelde Vandaag-scherm toont alleen het schema van vandaag, verder niets.'],
    ],
  },
  {
    id: 'vandaag',
    title: 'Vandaag',
    items: [
      ['Wat staat hier?', 'Bovenaan staat één duidelijke "Nu"-kaart met wat op dit moment belangrijk is, daaronder de afspraken van vandaag op volgorde van tijd, eventuele urgente meldingen over een rit, en ’s avonds een herinnering als de briefing voor morgen klaarstaat.'],
      ['Hoe lees je de eerstvolgende afspraak?', 'De eerstvolgende afspraak staat in de "Nu"-kaart, met de tijd erbij. Afspraken die al voorbij zijn worden verderop in de lijst minder nadrukkelijk getoond.'],
      ['Wat betekent "naar beneden"?', 'Sommige afspraken hebben in de agenda een expliciet tijdstip om naar beneden te gaan (bijvoorbeeld voor een rit). Zodra dat moment is aangebroken, verandert de "Nu"-kaart naar "U kunt nu naar beneden."'],
      ['Wat zie je als er geen afspraken zijn?', 'Een rustige melding dat er voor vandaag geen afspraken zijn — geen lege of verwarrende pagina.'],
    ],
  },
  {
    id: 'briefing',
    title: 'Briefing',
    items: [
      ['Waar komt de briefing vandaan?', 'De tekst wordt automatisch samengesteld uit de agenda van die dag. In de app is de tekst alleen-lezen; je kunt hem niet hier bewerken.'],
      ['Hoe controleer je de tekst?', 'Lees de Caren-regel en het WhatsApp-bericht rustig door voordat je ze verstuurt, en controleer of tijden en namen kloppen met wat je zelf weet.'],
      ['Hoe kopieer of deel je de briefing?', 'Gebruik "Kopieer Caren-regel" of "Kopieer WhatsApp-bericht" om de tekst naar het klembord te kopiëren, en plak hem daarna zelf in Caren of WhatsApp.'],
      ['Hoe zie je of de briefing al is verstuurd?', 'Elke dag heeft een label: "Klaar", "Verzonden ✓", of "Gewijzigd na verzending!" als de agenda na het versturen nog is aangepast. Met de knop eronder markeer je een briefing als verzonden, of open je hem weer.'],
    ],
  },
  {
    id: 'logboek',
    title: 'Logboek',
    items: [
      ['Een notitie toevoegen', 'Tik op de ronde plusknop rechtsonder in het Logboek. Kies een type, vul eventueel een titel, beschrijving en datum in, voeg desgewenst foto’s of één document toe, en kies de zichtbaarheid voordat je op "Plaatsen" tikt.'],
      ['Een eigen notitie bewerken of verwijderen', 'Bij je eigen notitie zie je een knop met drie puntjes (⋯). Daar kies je "Bewerken" om de tekst aan te passen, of "Verwijderen" om de notitie naar de prullenbak te verplaatsen.'],
      ['Wie kan welke notities beheren?', 'Je kunt altijd je eigen notities bewerken en naar de prullenbak verplaatsen. Een ander familielid kan jouw notitie niet aanpassen of verwijderen. De eigenaar (beheerder) kan wel elke notitie naar de prullenbak verplaatsen, en beheert de prullenbak: terugzetten of definitief verwijderen.'],
      ['Hoe gebruik je zoeken en filters?', 'Boven de tijdlijn staat een zoekbalk voor tekst, en een knop "Filters" voor auteur en een periode. De chips daaronder filteren op type en (voor familie) op zichtbaarheid. "Wis filters" zet alles weer terug.'],
      ['Hoe werkt de prullenbak?', 'Een verwijderde notitie verdwijnt meteen uit het logboek, met een tijdelijke melding "Ongedaan maken". Daarna blijft hij ongeveer 30 dagen bewaard in de prullenbak (Beheer → Prullenbak, alleen voor de eigenaar), die hem kan terugzetten of definitief verwijderen.'],
    ],
  },
  {
    id: 'documenten-verwerken',
    title: 'Documenten verwerken (alleen eigenaar)',
    items: [
      ['Wat doet "Documenten verwerken"?', 'Je kunt tekst plakken, één PDF uploaden, of een paar foto’s/scans van een document uploaden. Dat bronmateriaal wordt naar de geconfigureerde Claude API gestuurd, die een aantal voorstellen voor logboekregels maakt: een datum, een type, een titel, een korte beschrijving en eventuele labels.'],
      ['Komt er meteen iets in het Logboek te staan?', 'Nee. Er wordt niets automatisch gepubliceerd. Elk voorstel is een concept dat je eerst controleert — pas nadat je het hebt goedgekeurd, verschijnt het als gewone logboekregel, met jou als auteur.'],
      ['Hoe controleer je een voorstel?', 'Open het document in de Document-inbox en bekijk elk voorstel: je kunt de datum, het type, de titel, de beschrijving, de zichtbaarheid en de labels aanpassen. Onderaan elk voorstel staat een kort citaat uit de bron en waar dat vandaan komt, zodat je het kunt verifiëren. Je wijst een voorstel af, herstelt het weer, of vinkt het aan en plaatst het in het Logboek.'],
      ['Wat is het verschil tussen de datum van het document en de datum van de gebeurtenis?', 'De "datum van document" is een optioneel hulpmiddel dat jij zelf invult (bijvoorbeeld de datum bovenaan een brief). De datum die uiteindelijk bij een logboekregel komt te staan, is de datum waar die regel écht over gaat — dat kan dus anders zijn dan wanneer je het document hebt geüpload of verwerkt.'],
      ['Wat als een datum onduidelijk is?', 'Dan laat Claude de datum bewust leeg in plaats van te gokken, en zie je een waarschuwing waarom. Je kunt zelf alsnog een datum invullen als je die uit eigen kennis zeker weet.'],
      ['Wie ziet een voorstel of het originele document?', 'Alleen de eigenaar (beheerder) — voorstellen en het originele bronbestand zijn nooit zichtbaar voor familieleden of het zorgteam. Zodra je een voorstel goedkeurt, wordt het een gewone logboekregel die zichtbaar is volgens de zichtbaarheid die je koos (alleen familie, of familie en zorgteam) — net als bij elke andere logboekregel.'],
    ],
  },
  {
    id: 'agenda',
    title: 'Agenda',
    items: [
      ['Waar komen afspraken vandaan?', 'De Agenda is een alleen-lezen weergave van de gekoppelde familieagenda. Afspraken wijzig je altijd in de agenda-app zelf, nooit hier.'],
      ['Hoe herken je recente wijzigingen?', 'Wijzigingen in de gekoppelde agenda verschijnen hier vanzelf zodra de eerstvolgende synchronisatie is geweest — de afspraken zijn ingedeeld in Vandaag, Deze week en Binnenkort.'],
      ['Wat betekent de laatste synchronisatietijd?', 'Bovenaan de Agenda staat "Laatst bijgewerkt" met het moment van de laatste synchronisatie, zodat je in één oogopslag ziet hoe actueel de lijst is.'],
    ],
  },
  {
    id: 'beheer',
    title: 'Beheer',
    items: [
      ['Gebruikers en rollen', '"Mensen en toegang" toont iedereen met toegang tot de familie — familieleden, de eigenaar, en eventuele zorgteamleden — met hun rol en wanneer ze voor het laatst actief waren.'],
      ['Apparaten', 'Hier stel je het gekoppelde Vandaag-scherm in voor het familielid om wie het gaat, en trek je de toegang van een apparaat in als dat nodig is.'],
      ['Synchronisatiestatus', 'De kaart "Agenda-synchronisatie" laat zien of de agenda actueel is: wanneer voor het laatst succesvol gesynchroniseerd is, of er nu een synchronisatie loopt, en een korte foutmelding als er iets misging.'],
      ['Agenda handmatig bijwerken', 'Met "Agenda nu bijwerken" vraag je een directe synchronisatie aan in plaats van te wachten op de automatische ronde. Dit kan een paar minuten duren en werkt niet vaker dan één keer per minuut.'],
    ],
  },
  {
    id: 'veelgestelde-vragen',
    title: 'Veelgestelde vragen',
    items: [
      ['Waarom zie ik een wijziging nog niet?', 'De agenda synchroniseert automatisch, maar niet direct na elke wijziging. Een eigenaar kan in Beheer op "Agenda nu bijwerken" tikken om niet op de volgende automatische ronde te hoeven wachten.'],
      ['Wie kan een Logboek-item verwijderen?', 'De maker van de notitie kan zijn of haar eigen notitie verwijderen. De eigenaar (beheerder) kan daarnaast elke notitie verwijderen.'],
      ['Kan een verwijderd item worden teruggezet?', 'Ja. Direct na het verwijderen kan dat met "Ongedaan maken". Is die melding verdwenen, dan kan de eigenaar het item nog ongeveer 30 dagen terugzetten via Beheer → Prullenbak.'],
      ['Wat moet ik doen als de agenda niet is bijgewerkt?', 'Kijk in Beheer bij "Agenda-synchronisatie" voor de status en een eventuele foutmelding. Een eigenaar kan daar ook een directe synchronisatie aanvragen met "Agenda nu bijwerken".'],
    ],
  },
];

export async function mount(container) {
  container.innerHTML = `
    <div class="view-uitleg">
      <div class="view-header">
        <h1>Uitleg &amp; veelgestelde vragen</h1>
      </div>

      <nav class="uitleg-toc" aria-label="Inhoudsopgave">
        ${SECTIONS.map(s => `<a href="#uitleg-${s.id}">${s.title}</a>`).join('')}
      </nav>

      ${SECTIONS.map(renderSection).join('')}
    </div>
  `;
}

function renderSection(section) {
  return `
    <section class="uitleg-section" id="uitleg-${section.id}">
      <h2 class="section-title">${section.title}</h2>
      ${section.items.map(([q, a]) => `
        <div class="uitleg-item">
          <h3 class="uitleg-question">${q}</h3>
          <p class="uitleg-answer">${a}</p>
        </div>
      `).join('')}
    </section>
  `;
}
