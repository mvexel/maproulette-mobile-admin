/** Help for organizers (organizer-admin.md §2): how a campaign goes, and who to ask. */
export function Help() {
  return (
    <section className="help">
      <h2>Help</h2>
      <h3>Running a campaign</h3>
      <ol>
        <li>
          Start a new campaign from Campaigns. Pick the place, choose what to check and leave out any places people
          shouldn't go.
        </li>
        <li>Try it on your phone before you publish.</li>
        <li>Publish it, then share the invite link or the table card with your group.</li>
        <li>
          During the event, follow along on the live map. Afterwards, local mappers check the answers on the review
          page and add them to OpenStreetMap. You can also download the results.
        </li>
      </ol>
      <h3>Saving answers</h3>
      <p>
        The Street Tally team turns saving answers on or off for this server. The status at the top of every page
        shows whether it's on. If it's off before your event, ask us to turn it on.
      </p>
      <h3>Questions</h3>
      <p>
        Ask <a href="mailto:martijn@osm.lol">martijn@osm.lol</a>.
      </p>
    </section>
  );
}
