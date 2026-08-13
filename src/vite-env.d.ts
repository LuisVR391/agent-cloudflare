/// <reference types="vite/client" />

// `import.meta.env.DEV` distingue el servidor de desarrollo del artefacto
// construido. El Worker lo usa para no incluir siquiera el enganche de las
// rutas de desarrollo en el bundle que se despliega.
