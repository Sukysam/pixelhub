import next from "eslint-config-next";

const config = [
  ...next,
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
];

export default config;
