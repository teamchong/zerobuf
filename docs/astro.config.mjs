import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://teamchong.github.io",
  base: "/zerobuf",
  integrations: [
    starlight({
      title: "zerobuf",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/teamchong/zerobuf",
        },
      ],
      sidebar: [
        { label: "Overview", slug: "index" },
        { label: "Getting Started", slug: "getting-started" },
        {
          label: "Guides",
          items: [
            { label: "With Zig", slug: "guides/with-zig" },
            { label: "With Durable Objects", slug: "guides/with-durable-objects" },
          ],
        },
        {
          label: "Spec",
          items: [
            { label: "Memory Layout", slug: "spec/memory-layout" },
          ],
        },
      ],
    }),
  ],
});
