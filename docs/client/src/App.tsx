/* Calm docs system: root is a welcome surface; all detailed reference content is routed under /docs. */
import { Route, Switch } from "wouter";
import Home from "./pages/Home";
import Docs from "./pages/Docs";
import NotFound from "./pages/NotFound";

export default function App() {
  return <Switch><Route path="/" component={Home} /><Route path="/docs/:slug/:plugin" component={Docs} /><Route path="/docs/:slug" component={Docs} /><Route path="/docs" component={Docs} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>;
}
