import { graphql } from "gatsby";

export const pageQuery = graphql`
  query HomePage { site { siteMetadata { title } } }
`;

export default function HomePage() {
  return "Acme";
}
