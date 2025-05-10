import config from "@bootloader/config";

function extractTenantFromReq(req) {
  if (req.query.tnt) {
    return req.query.tnt;
  } else if (req.headers["tnt"]) {
    return req.headers["tnt"];
  } else if (req.subdomains && req.subdomains.length > 0) {
    let ngrokDomain = config.getIfPresent("ngrok.domain");
    if (ngrokDomain) {
      ngrokDomain = ngrokDomain.split(".")[0];
    }
    if (req.subdomains[0] === ngrokDomain) return "demo";
    return req.subdomains[0];
  } else if (req.hostname === "localhost") {
    return "demo";
  }
}

export default function middleware({ request, response, next }) {
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! app-pushapp ContextParser");

  request.context = extractTenantFromReq(request);

  return true;
}
