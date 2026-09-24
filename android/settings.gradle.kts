pluginManagement {
    repositories {
        google()
        System.getenv("SOUP_MAVEN_MIRROR")?.let { maven(it) }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        System.getenv("SOUP_MAVEN_MIRROR")?.let { maven(it) }
        mavenCentral()
    }
}
rootProject.name = "TurtleSoup"
include(":app")
