Analysis: Open Source SaaS Metadata & Relationship Discovery
This document evaluates existing open-source frameworks that can replace or augment our custom "Deep Schema Inspection" logic for fetching related objects.

1. Option A: Nango (The B2B Metadata Specialist)
Nango is perhaps the closest open-source relative to Soopa. While they offer a cloud service, their core engine and metadata logic are open-source.
How it solves "Related Objects":
Nango has a specialized metadata feature. For Salesforce, it doesn't just return a list of fields; it returns the relationshipName and referenceTo metadata from the Salesforce Describe API.
Soopa Implementation: We can "borrow" the Nango Salesforce metadata adapter and wrap it in our IDiscoveryAdapter.
Benefit: You get 100% accurate relationship discovery for the "Big 5" (Salesforce, HubSpot, NetSuite, Dynamics, Zendesk) instantly.
2. Option B: Singer.io "Catalogs" (The Data Standard)
Singer is the protocol that powers tools like Stitch and Meltano. Every Singer "Tap" (Source) has a discover mode.
How it works:
When you run a Tap (e.g., tap-salesforce --discover), it outputs a Catalog JSON.
{
  "streams": [{
    "tap_stream_id": "Account",
    "schema": {
      "properties": {
        "Id": { "type": "string" },
        "ParentId": { "type": ["null", "string"], "foreign_key": "Account" }
      }
    }
  }]
}


Soopa Implementation: We don't need to run the Python code. We can use the community-maintained Catalog definitions as a "Static Brain" for our AI, while using our native connectors to do the actual fetching.

3. Option C: Airbyte's "Discover" Protocol
Airbyte is the most well-funded open-source integration project. Their connectors are highly sophisticated.
How it works:
Every Airbyte connector must implement a discover method that returns an AirbyteCatalog.
Strength: It is exceptionally good at identifying Incremental Cursors and Primary Keys.
Weakness: It is designed for ELT (Data Warehousing), not real-time SEDA pipelines. The code is often wrapped in Docker containers, making "Real-time Metadata Lookups" high-latency.

4. Recommendation: The "Augmented Framework" Strategy
Since we are already committed to the Piece framework for the execution of actions/triggers, I recommend a Hybrid Approach:
Execution: Stay with the Piece infrastructure (it's the best for the component model).
Discovery (The "Brain"): Port the Nango Metadata Adapters into our engine/application/connectors/src/intelligence folder.
Nango's metadata logic for Salesforce and HubSpot is written in TypeScript.
It handles the complexity of "Relational Joins" and "Field Types" significantly better than standard piece metadata logic.
Standardization: Adopt the Singer Catalog Format internally. Even if we don't use Singer code, representing our "Discovered Graph" in Singer-standard JSON makes our platform compatible with every other data tool in the ecosystem.

5. Summary Verdict
Don't build the "Describe API" logic for 500 apps from scratch.
Use Nango's logic for the high-value, high-complexity apps (Salesforce/NetSuite).
Use the Piece framework logic for the long tail of simpler apps.
Use Singer-style JSON as the universal internal language for the "Object Graph."
