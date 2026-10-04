# ChatGPT Financial Review Instructions

Open your existing regular financial ChatGPT conversation. Attach the private
`review-input-*.json` downloaded from the Squires app's Reviews view. Give it
this message:

> Read the attached snapshot, analysis_instructions, packet_schema, and
> example_packet. Use the financial accounts and household discussions you
> can actually access in this conversation. Produce a substantial review
> for the snapshot's exact period: what went well, what needs attention,
> practical ways to stretch money, upcoming obligations, progress on earlier
> suggestions, assumptions, missing information, evidence and follow-up
> tasks. Distinguish agreed commitments from new suggestions. Follow the
> snapshot's budget-counting rules; do not count matched bank imports twice
> or treat SNAP as unrestricted cash. Do not guess missing balances or
> conversation history. Return exactly one finished JSON file named
> financial-review.json that validates against packet_schema. Replace every
> placeholder in example_packet. Do not say it has been delivered to the app.

Then give Muse the completed JSON file, or import it in the app's Reviews view.
Muse must verify the app receipt before reporting delivery. The automatic
ChatGPT handoff depends on Muse's actual capabilities; the app integration
alone does not establish it.
