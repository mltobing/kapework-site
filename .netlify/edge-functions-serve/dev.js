import { boot } from "https://v2-17-1--edge.netlify.com/bootstrap/index-combined.ts";

const functions = {}; const metadata = { functions: {} };


      try {
        const { default: func } = await import("file:///Users/martinloembantobing/kapework/kapework-site/netlify/edge-functions/subdomain-router.ts");

        if (typeof func === "function") {
          functions["subdomain-router"] = func;
          metadata.functions["subdomain-router"] = {"url":"file:///Users/martinloembantobing/kapework/kapework-site/netlify/edge-functions/subdomain-router.ts"}
        } else {
          console.log("\u001b[91m⬥\u001b[39m \u001b[31mFailed\u001b[39m to load Edge Function \u001b[33msubdomain-router\u001b[39m. The file does not seem to have a function as the default export.");
        }
      } catch (error) {
        console.log("\u001b[91m⬥\u001b[39m \u001b[31mFailed\u001b[39m to run Edge Function \u001b[33msubdomain-router\u001b[39m:");
        console.error(error);
      }
      

boot(() => Promise.resolve(functions));