import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { mobileEnv } from "./src/config/env";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>Home Inventory</Text>
      <Text style={styles.title}>Mobile Bootstrap Ready</Text>
      <Text style={styles.detail}>Environment: {mobileEnv.environment}</Text>
      <Text style={styles.detail}>API: {mobileEnv.apiBaseUrl}</Text>
      <Text style={styles.detail}>
        User Accounts: {mobileEnv.requireUserAccounts ? "required" : "optional"}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f3ee",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  kicker: {
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
    color: "#475569",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 20,
    color: "#1e293b",
    textAlign: "center",
  },
  detail: {
    fontSize: 16,
    color: "#334155",
    marginBottom: 8,
    textAlign: "center",
  },
});
